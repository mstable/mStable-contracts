/* solium-disable security/no-block-members */
pragma solidity 0.5.16;

import { IBasicToken } from "../shared/IBasicToken.sol";

import { IIncentivisedVotingLockup } from "../interfaces/IIncentivisedVotingLockup.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RewardsDistributionRecipient } from "../rewards/RewardsDistributionRecipient.sol";

import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SignedSafeMath128 } from "../shared/SignedSafeMath128.sol";
import { StableMath, SafeMath } from "../shared/StableMath.sol";
import { Root } from "../shared/Root.sol";

/**
 * @title  IncentivisedVotingLockup
 * @author Voting Weight tracking & Decay
 *             -> Curve Finance (MIT) - forked & ported to Solidity
 *             -> https://github.com/curvefi/curve-dao-contracts/blob/master/contracts/VotingEscrow.vy
 *         osolmaz - Research & Reward distributions
 *         alsco77 - Solidity implementation
 * @notice Lockup MTA, receive vMTA (voting weight that decays over time), and earn
 *         rewards based on staticWeight
 * @dev    Supports:
 *            1) Tracking MTA Locked up (LockedBalance)
 *            2) Pull Based Reward allocations based on Lockup (Static Balance)
 *            3) Decaying voting weight lookup through CheckpointedERC20 (balanceOf)
 *            4) Ejecting fully decayed participants from reward allocation (eject)
 *            5) Migration of points to v2 (used as multiplier in future) ***** (rewardsPaid)
 *            6) Closure of contract (expire)
 */
contract IncentivisedVotingLockup is
    IIncentivisedVotingLockup,
    ReentrancyGuard,
    RewardsDistributionRecipient
{
    using StableMath for uint256;
    using SafeMath for uint256;
    using SignedSafeMath128 for int128;
    using SafeERC20 for IERC20;

    /** Shared Events */
    event Deposit(address indexed provider, uint256 value, uint256 locktime, LockAction indexed action, uint256 ts);
    event Withdraw(address indexed provider, uint256 value, uint256 ts);
    event Ejected(address indexed ejected, address ejector, uint256 ts);
    event Expired();
    event RewardAdded(uint256 reward);
    event RewardPaid(address indexed user, uint256 reward);

    /** Shared Globals */
    IERC20 public stakingToken;
    uint256 private constant WEEK = 7 days;
    uint256 public constant MAXTIME = 365 days;
    uint256 public END;
    bool public expired = false;

    /** Lockup */
    uint256 public globalEpoch;
    Point[] public pointHistory;
    mapping(address => Point[]) public userPointHistory;
    mapping(address => uint256) public userPointEpoch;
    mapping(uint256 => int128) public slopeChanges;
    mapping(address => LockedBalance) public locked;

    // Voting token - Checkpointed view only ERC20
    string public name;
    string public symbol;
    uint256 public decimals = 18;

    /** Rewards */
    // Updated upon admin deposit
    uint256 public periodFinish = 0;
    uint256 public rewardRate = 0;

    // Globals updated per stake/deposit/withdrawal
    uint256 public totalStaticWeight = 0;
    uint256 public lastUpdateTime = 0;
    uint256 public rewardPerTokenStored = 0;

    // Per user storage updated per stake/deposit/withdrawal
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;
    mapping(address => uint256) public rewardsPaid;

    /** Structs */
    struct Point {
        int128 bias;
        int128 slope;
        uint256 ts;
        uint256 blk;
    }

    struct LockedBalance {
        int128 amount;
        uint256 end;
    }

    enum LockAction {
        CREATE_LOCK,
        INCREASE_LOCK_AMOUNT,
        INCREASE_LOCK_TIME
    }

    constructor(
        address _stakingToken,
        string memory _name,
        string memory _symbol,
        address _nexus,
        address _rewardsDistributor
    )
        public
        RewardsDistributionRecipient(_nexus, _rewardsDistributor)
    {
        stakingToken = IERC20(_stakingToken);
        Point memory init = Point({ bias: int128(0), slope: int128(0), ts: block.timestamp, blk: block.number});
        pointHistory.push(init);

        decimals = IBasicToken(_stakingToken).decimals();
        require(decimals <= 18, "Cannot have more than 18 decimals");

        name = _name;
        symbol = _symbol;

        END = block.timestamp.add(MAXTIME);
    }

    /** @dev Modifier to ensure contract has not yet expired */
    modifier contractNotExpired(){
        require(!expired, "Contract is expired");
        _;
    }

    /**
    * @dev Validates that the user has an expired lock && they still have capacity to earn
    * @param _addr User address to check
    */
    modifier lockupIsOver(address _addr) {
        LockedBalance memory userLock = locked[_addr];
        require(userLock.amount > 0 && block.timestamp >= userLock.end, "Users lock didn't expire");
        require(staticBalanceOf(_addr) > 0, "User must have existing bias");
        _;
    }

    /***************************************
                LOCKUP - GETTERS
    ****************************************/

    /**
     * @dev Gets the last available user point
     * @param _addr User address
     * @return bias i.e. y
     * @return slope i.e. linear gradient
     * @return ts i.e. time point was logged
     */
    function getLastUserPoint(address _addr)
        external
        view
        returns(
            int128 bias,
            int128 slope,
            uint256 ts
        )
    {
        uint256 uepoch = userPointEpoch[_addr];
        if(uepoch == 0){
            return (0, 0, 0);
        }
        Point memory point = userPointHistory[_addr][uepoch];
        return (point.bias, point.slope, point.ts);
    }

    /***************************************
                    LOCKUP
    ****************************************/

    /**
     * @dev Records a checkpoint of both individual and global slope
     * @param _addr User address, or address(0) for only global
     * @param _oldLocked Old amount that user had locked, or null for global
     * @param _newLocked new amount that user has locked, or null for global
     */
    function _checkpoint(
        address _addr,
        LockedBalance memory _oldLocked,
        LockedBalance memory _newLocked
    )
        internal
    {
        Point memory userOldPoint;
        Point memory userNewPoint;
        int128 oldSlopeDelta = 0;
        int128 newSlopeDelta = 0;
        uint256 epoch = globalEpoch;

        if(_addr != address(0)){
            // Calculate slopes and biases
            // Kept at zero when they have to
            if(_oldLocked.end > block.timestamp && _oldLocked.amount > 0){
                userOldPoint.slope = _oldLocked.amount.div(int128(MAXTIME));
                userOldPoint.bias = userOldPoint.slope.mul(int128(_oldLocked.end.sub(block.timestamp)));
            }
            if(_newLocked.end > block.timestamp && _newLocked.amount > 0){
                userNewPoint.slope = _newLocked.amount.div(int128(MAXTIME));
                userNewPoint.bias = userNewPoint.slope.mul(int128(_newLocked.end.sub(block.timestamp)));
            }

            // Moved from bottom final if statement to resolve stack too deep err
            // start {
            // Now handle user history
            uint256 uEpoch = userPointEpoch[_addr];
            if(uEpoch == 0){
                userPointHistory[_addr].push(userOldPoint);
            }
            // track the total static weight
            uint256 newStatic = _staticBalance(userNewPoint.slope, block.timestamp, _newLocked.end);
            uint256 additiveStaticWeight = totalStaticWeight.add(newStatic);
            if(uEpoch > 0){
                uint256 oldStatic = _staticBalance(userPointHistory[_addr][uEpoch].slope, userPointHistory[_addr][uEpoch].ts, _oldLocked.end);
                additiveStaticWeight = additiveStaticWeight.sub(oldStatic);
            }
            totalStaticWeight = additiveStaticWeight;

            userPointEpoch[_addr] = uEpoch.add(1);
            userNewPoint.ts = block.timestamp;
            userNewPoint.blk = block.number;
            // userPointHistory[_addr][uEpoch.add(1)] = userNewPoint;
            userPointHistory[_addr].push(userNewPoint);

            // } end

            // Read values of scheduled changes in the slope
            // oldLocked.end can be in the past and in the future
            // newLocked.end can ONLY by in the FUTURE unless everything expired: than zeros
            oldSlopeDelta = slopeChanges[_oldLocked.end];
            if(_newLocked.end != 0){
                if (_newLocked.end == _oldLocked.end) {
                    newSlopeDelta = oldSlopeDelta;
                } else {
                    newSlopeDelta = slopeChanges[_newLocked.end];
                }
            }
        }

        Point memory lastPoint = Point({bias: 0, slope: 0, ts: block.timestamp, blk: block.number});
        if(epoch > 0){
            lastPoint = pointHistory[epoch];
        }
        uint256 lastCheckpoint = lastPoint.ts;

        // initialLastPoint is used for extrapolation to calculate block number
        // (approximately, for *At methods) and save them
        // as we cannot figure that out exactly from inside the contract
        Point memory initialLastPoint = Point({bias: 0, slope: 0, ts: lastPoint.ts, blk: lastPoint.blk});
        uint256 blockSlope = 0; // dblock/dt
        if(block.timestamp > lastPoint.ts){
            blockSlope = StableMath.scaleInteger(block.number.sub(lastPoint.blk)).div(block.timestamp.sub(lastPoint.ts));
        }
        // If last point is already recorded in this block, slope=0
        // But that's ok b/c we know the block in such case

        // Go over weeks to fill history and calculate what the current point is
        uint256 iterativeTime = _floorToWeek(lastCheckpoint);
        for (uint256 i = 0; i < 255; i++){
            // Hopefully it won't happen that this won't get used in 5 years!
            // If it does, users will be able to withdraw but vote weight will be broken
            iterativeTime = iterativeTime.add(WEEK);
            int128 dSlope = 0;
            if(iterativeTime > block.timestamp){
                iterativeTime = block.timestamp;
            } else {
                dSlope = slopeChanges[iterativeTime];
            }
            int128 biasDelta = lastPoint.slope.mul(int128(iterativeTime.sub(lastCheckpoint)));
            lastPoint.bias = lastPoint.bias.sub(biasDelta);
            lastPoint.slope = lastPoint.slope.add(dSlope);
            // This can happen
            if(lastPoint.bias < 0){
                lastPoint.bias = 0;
            }
            // This cannot happen - just in case
            if(lastPoint.slope < 0){
                lastPoint.slope = 0;
            }
            lastCheckpoint = iterativeTime;
            lastPoint.ts = iterativeTime;
            lastPoint.blk = initialLastPoint.blk.add(blockSlope.mulTruncate(iterativeTime.sub(initialLastPoint.ts)));

            // when epoch is incremented, we either push here or after slopes updated below
            epoch = epoch.add(1);
            if(iterativeTime == block.timestamp) {
                lastPoint.blk = block.number;
                break;
            } else {
                // pointHistory[epoch] = lastPoint;
                pointHistory.push(lastPoint);
            }
        }

        globalEpoch = epoch;
        // Now pointHistory is filled until t=now

        if(_addr != address(0)){
            // If last point was in this block, the slope change has been applied already
            // But in such case we have 0 slope(s)
            lastPoint.slope = lastPoint.slope.add(userNewPoint.slope.sub(userOldPoint.slope));
            lastPoint.bias = lastPoint.bias.add(userNewPoint.bias.sub(userOldPoint.bias));
            if(lastPoint.slope < 0) {
                lastPoint.slope = 0;
            }
            if(lastPoint.bias < 0){
                lastPoint.bias = 0;
            }
        }

        // Record the changed point into history
        // pointHistory[epoch] = lastPoint;
        pointHistory.push(lastPoint);

        if(_addr != address(0)){
            // Schedule the slope changes (slope is going down)
            // We subtract new_user_slope from [new_locked.end]
            // and add old_user_slope to [old_locked.end]
            if(_oldLocked.end > block.timestamp){
                // oldSlopeDelta was <something> - userOldPoint.slope, so we cancel that
                oldSlopeDelta = oldSlopeDelta.add(userOldPoint.slope);
                if(_newLocked.end == _oldLocked.end) {
                    oldSlopeDelta = oldSlopeDelta.sub(userNewPoint.slope);  // It was a new deposit, not extension
                }
                slopeChanges[_oldLocked.end] = oldSlopeDelta;
            }
            if(_newLocked.end > block.timestamp) {
                if(_newLocked.end > _oldLocked.end){
                    newSlopeDelta = newSlopeDelta.sub(userNewPoint.slope);  // old slope disappeared at this point
                    slopeChanges[_newLocked.end] = newSlopeDelta;
                }
                // else: we recorded it already in oldSlopeDelta
            }
        }
    }

    /**
     * @dev Deposits or creates a stake for a given address
     * @param _addr User address to assign the stake
     * @param _value Total units of StakingToken to lockup
     * @param _unlockTime Time at which the stake should unlock
     * @param _oldLocked Previous amount staked by this user
     * @param _action See LockAction enum
     */
    function _depositFor(
        address _addr,
        uint256 _value,
        uint256 _unlockTime,
        LockedBalance memory _oldLocked,
        LockAction _action
    )
        internal
    {
        LockedBalance memory newLocked = LockedBalance({amount: _oldLocked.amount, end: _oldLocked.end});

        // Adding to existing lock, or if a lock is expired - creating a new one
        newLocked.amount = newLocked.amount.add(int128(_value));
        if(_unlockTime != 0){
            newLocked.end = _unlockTime;
        }
        locked[_addr] = newLocked;

        // Possibilities:
        // Both _oldLocked.end could be current or expired (>/< block.timestamp)
        // value == 0 (extend lock) or value > 0 (add to lock or extend lock)
        // newLocked.end > block.timestamp (always)
        _checkpoint(_addr, _oldLocked, newLocked);

        if(_value != 0) {
            stakingToken.safeTransferFrom(_addr, address(this), _value);
        }

        emit Deposit(_addr, _value, newLocked.end, _action, block.timestamp);
    }

    /**
     * @dev Public function to trigger global checkpoint
     */
    function checkpoint() external {
        LockedBalance memory empty;
        _checkpoint(address(0), empty, empty);
    }

    /**
     * @dev Creates a new lock
     * @param _value Total units of StakingToken to lockup
     * @param _unlockTime Time at which the stake should unlock
     */
    function createLock(uint256 _value, uint256 _unlockTime)
        external
        nonReentrant
        contractNotExpired
        updateReward(msg.sender)
    {
        uint256 unlock_time = _floorToWeek(_unlockTime);  // Locktime is rounded down to weeks
        LockedBalance memory locked_ = LockedBalance({amount: locked[msg.sender].amount, end: locked[msg.sender].end});

        require(_value > 0, "Must stake non zero amount");
        require(locked_.amount == 0, "Withdraw old tokens first");

        require(unlock_time > block.timestamp, "Can only lock until time in the future");
        require(unlock_time <= END, "Voting lock can be 1 year max (until recol)");

        _depositFor(msg.sender, _value, unlock_time, locked_, LockAction.CREATE_LOCK);
    }

    /**
     * @dev Increases amount of stake thats locked up & resets decay
     * @param _value Additional units of StakingToken to add to exiting stake
     */
    function increaseLockAmount(uint256 _value)
        external
        nonReentrant
        contractNotExpired
        updateReward(msg.sender)
    {
        LockedBalance memory locked_ = LockedBalance({amount: locked[msg.sender].amount, end: locked[msg.sender].end});

        require(_value > 0, "Must stake non zero amount");
        require(locked_.amount > 0, "No existing lock found");
        require(locked_.end > block.timestamp, "Cannot add to expired lock. Withdraw");

        _depositFor(msg.sender, _value, 0, locked_, LockAction.INCREASE_LOCK_AMOUNT);
    }

    /**
     * @dev Increases length of lockup & resets decay
     * @param _unlockTime New unlocktime for lockup
     */
    function increaseLockLength(uint256 _unlockTime)
        external
        nonReentrant
        contractNotExpired
        updateReward(msg.sender)
    {
        LockedBalance memory locked_ = LockedBalance({amount: locked[msg.sender].amount, end: locked[msg.sender].end});
        uint256 unlock_time = _floorToWeek(_unlockTime);  // Locktime is rounded down to weeks

        require(locked_.amount > 0, "Nothing is locked");
        require(locked_.end > block.timestamp, "Lock expired");
        require(unlock_time > locked_.end, "Can only increase lock WEEK");
        require(unlock_time <= END, "Voting lock can be 1 year max (until recol)");

        _depositFor(msg.sender, 0, unlock_time, locked_, LockAction.INCREASE_LOCK_TIME);
    }

    /**
     * @dev Withdraws all the senders stake, providing lockup is over
     */
    function withdraw()
        external
    {
        _withdraw(msg.sender);
    }

    /**
     * @dev Withdraws a given users stake, providing the lockup has finished
     * @param _addr User for which to withdraw
     */
    function _withdraw(address _addr)
        internal
        nonReentrant
        updateReward(_addr)
    {
        LockedBalance memory oldLock = LockedBalance({ end: locked[_addr].end, amount: locked[_addr].amount });
        require(block.timestamp >= oldLock.end || expired, "The lock didn't expire");
        require(oldLock.amount > 0, "Must have something to withdraw");

        uint256 value = uint256(oldLock.amount);

        LockedBalance memory currentLock = LockedBalance({end: 0, amount: 0});
        locked[_addr] = currentLock;

        // oldLocked can have either expired <= timestamp or zero end
        // currentLock has only 0 end
        // Both can have >= 0 amount
        if(!expired){
            _checkpoint(_addr, oldLock, currentLock);
        }

        stakingToken.safeTransfer(_addr, value);

        emit Withdraw(_addr, value, block.timestamp);
    }

    /**
     * @dev Withdraws and consequently claims rewards for the sender
     */
    function exit()
        external
    {
        _withdraw(msg.sender);
        claimReward();
    }

    /**
     * @dev Ejects a user from the reward allocation, given their lock has freshly expired.
     * Leave it to the user to withdraw and claim their rewards.
     * @param _addr Address of the user
     */
    function eject(address _addr)
        external
        contractNotExpired
        lockupIsOver(_addr)
    {
        _withdraw(_addr);

        // solium-disable-next-line security/no-tx-origin
        emit Ejected(_addr, tx.origin, block.timestamp);
    }

    /**
     * @dev Ends the contract, unlocking all stakes.
     * No more staking can happen. Only withdraw and Claim.
     */
    function expireContract()
        external
        onlyGovernor
        contractNotExpired
        updateReward(address(0))
    {
        require(block.timestamp > periodFinish, "Period must be over");

        expired = true;

        emit Expired();
    }



    /***************************************
                    GETTERS
    ****************************************/


    /** @dev Floors a timestamp to the nearest weekly increment */
    function _floorToWeek(uint256 _t)
        internal
        pure
        returns(uint256)
    {
        return _t.div(WEEK).mul(WEEK);
    }

    /**
     * @dev Uses binarysearch to find the most recent point history preceeding block
     * @param _block Find the most recent point history before this block
     * @param _maxEpoch Do not search pointHistories past this index
     */
    function _findBlockEpoch(uint256 _block, uint256 _maxEpoch)
        internal
        view
        returns(uint256)
    {
        // Binary search
        uint256 min = 0;
        uint256 max = _maxEpoch;
        // Will be always enough for 128-bit numbers
        for(uint256 i = 0; i < 128; i++){
            if (min >= max)
                break;
            uint256 mid = (min.add(max).add(1)).div(2);
            if (pointHistory[mid].blk <= _block){
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    /**
     * @dev Uses binarysearch to find the most recent user point history preceeding block
     * @param _addr User for which to search
     * @param _block Find the most recent point history before this block
     */
    function _findUserBlockEpoch(address _addr, uint256 _block)
        internal
        view
        returns(uint256)
    {
        uint256 min = 0;
        uint256 max = userPointEpoch[_addr];
        for(uint256 i = 0; i < 128; i++) {
            if(min >= max){
                break;
            }
            uint256 mid = (min.add(max).add(1)).div(2);
            if(userPointHistory[_addr][mid].blk <= _block){
                min = mid;
            } else {
                max = mid.sub(1);
            }
        }
        return min;
    }

    /**
     * @dev Gets curent user voting weight (aka effectiveStake)
     * @param _owner User for which to return the balance
     * @return uint256 Balance of user
     */
    function balanceOf(address _owner)
        public
        view
        returns (uint256)
    {
        uint256 epoch = userPointEpoch[_owner];
        if(epoch == 0){
            return 0;
        }
        Point memory lastPoint = userPointHistory[_owner][epoch];
        lastPoint.bias = lastPoint.bias.sub(lastPoint.slope.mul(int128(block.timestamp.sub(lastPoint.ts))));
        if(lastPoint.bias < 0) {
            lastPoint.bias = 0;
        }
        return uint256(lastPoint.bias);
    }

    /**
     * @dev Gets a users votingWeight at a given blockNumber
     * @param _owner User for which to return the balance
     * @param _blockNumber Block at which to calculate balance
     * @return uint256 Balance of user
     */
    function balanceOfAt(address _owner, uint256 _blockNumber)
        public
        view
        returns (uint256)
    {
        require(_blockNumber <= block.number, "Must pass block number in the past");

        // Get most recent user Point to block
        uint256 userEpoch = _findUserBlockEpoch(_owner, _blockNumber);
        if(userEpoch == 0){
            return 0;
        }
        Point memory upoint = userPointHistory[_owner][userEpoch];

        // Get most recent global Point to block
        uint256 maxEpoch = globalEpoch;
        uint256 epoch = _findBlockEpoch(_blockNumber, maxEpoch);
        Point memory point0 = pointHistory[epoch];

        // Calculate delta (block & time) between user Point and target block
        // Allowing us to calculate the average seconds per block between
        // the two points
        uint256 dBlock = 0;
        uint256 dTime = 0;
        if(epoch < maxEpoch){
            Point memory point1 = pointHistory[epoch.add(1)];
            dBlock = point1.blk.sub(point0.blk);
            dTime = point1.ts.sub(point0.ts);
        } else {
            dBlock = block.number.sub(point0.blk);
            dTime = block.timestamp.sub(point0.ts);
        }
        // (Deterministically) Estimate the time at which block _blockNumber was mined
        uint256 blockTime = point0.ts;
        if(dBlock != 0) {
            // blockTime += dTime * (_blockNumber - point0.blk) / dBlock;
            blockTime = blockTime.add(dTime.mul(_blockNumber.sub(point0.blk)).div(dBlock));
        }
        // Current Bias = most recent bias - (slope * time since update)
        upoint.bias = upoint.bias.sub(upoint.slope.mul(int128(blockTime.sub(upoint.ts))));
        if(upoint.bias >= 0){
            return uint256(upoint.bias);
        } else {
            return 0;
        }
    }

    /**
     * @dev Calculates total supply of votingWeight at a given time _t
     * @param _point Most recent point before time _t
     * @param _t Time at which to calculate supply
     * @return totalSupply at given point in time
     */
    function _supplyAt(Point memory _point, uint256 _t)
        internal
        view
        returns (uint256)
    {
        Point memory lastPoint = _point;
        // Floor the timestamp to weekly interval
        uint256 iterativeTime = _floorToWeek(lastPoint.ts);
        // Iterate through all weeks between _point & _t to account for slope changes
        for(uint256 i = 0; i < 255; i++){
            iterativeTime = iterativeTime.add(WEEK);
            int128 dSlope = 0;
            // If week end is after timestamp, then truncate & leave dSlope to 0
            if(iterativeTime > _t){
                iterativeTime = _t;
            }
            // else get most recent slope change
            else {
                dSlope = slopeChanges[iterativeTime];
            }

            // lastPoint.bias -= lastPoint.slope * convert(iterativeTime - lastPoint.ts, int128)
            lastPoint.bias = lastPoint.bias.sub(lastPoint.slope.mul(int128(iterativeTime.sub(lastPoint.ts))));
            if(iterativeTime == _t){
                break;
            }
            lastPoint.slope = lastPoint.slope.add(dSlope);
            lastPoint.ts = iterativeTime;
        }

        if (lastPoint.bias < 0){
            lastPoint.bias = 0;
        }
        return uint256(lastPoint.bias);
    }

    /**
     * @dev Calculates current total supply of votingWeight
     * @return totalSupply of voting token weight
     */
    function totalSupply()
        public
        view
        returns (uint256)
    {
        uint256 epoch_ = globalEpoch;
        Point memory lastPoint = pointHistory[epoch_];
        return _supplyAt(lastPoint, block.timestamp);
    }

    /**
     * @dev Calculates total supply of votingWeight at a given blockNumber
     * @param _blockNumber Block number at which to calculate total supply
     * @return totalSupply of voting token weight at the given blockNumber
     */
    function totalSupplyAt(uint256 _blockNumber)
        public
        view
        returns (uint256)
    {
        require(_blockNumber <= block.number, "Must pass block number in the past");

        uint256 epoch = globalEpoch;
        uint256 targetEpoch = _findBlockEpoch(_blockNumber, epoch);

        Point memory point = pointHistory[targetEpoch];

        // If point.blk > _blockNumber that means we got the initial epoch & contract did not yet exist
        if(point.blk > _blockNumber){
            return 0;
        }

        uint256 dTime = 0;
        if(targetEpoch < epoch){
            Point memory pointNext = pointHistory[targetEpoch.add(1)];
            if(point.blk != pointNext.blk) {
                dTime = (_blockNumber.sub(point.blk)).mul(pointNext.ts.sub(point.ts)).div(pointNext.blk.sub(point.blk));
            }
        } else if (point.blk != block.number){
            dTime = (_blockNumber.sub(point.blk)).mul(block.timestamp.sub(point.ts)).div(block.number.sub(point.blk));
        }
        // Now dTime contains info on how far are we beyond point

        return _supplyAt(point, point.ts.add(dTime));
    }


    /***************************************
                    REWARDS
    ****************************************/

    /** @dev Updates the reward for a given address, before executing function */
    modifier updateReward(address _account) {
        // Setting of global vars
        uint256 newRewardPerToken = rewardPerToken();
        // If statement protects against loss in initialisation case
        if(newRewardPerToken > 0) {
            rewardPerTokenStored = newRewardPerToken;
            lastUpdateTime = lastTimeRewardApplicable();
            // Setting of personal vars based on new globals
            if (_account != address(0)) {
                rewards[_account] = earned(_account);
                userRewardPerTokenPaid[_account] = newRewardPerToken;
            }
        }
        _;
    }

    /**
     * @dev Claims outstanding rewards for the sender.
     * First updates outstanding reward allocation and then transfers.
     */
    function claimReward()
        public
        updateReward(msg.sender)
    {
        uint256 reward = rewards[msg.sender];
        if (reward > 0) {
            rewards[msg.sender] = 0;
            stakingToken.safeTransfer(msg.sender, reward);
            rewardsPaid[msg.sender] = rewardsPaid[msg.sender].add(reward);
            emit RewardPaid(msg.sender, reward);
        }
    }


    /***************************************
                REWARDS - GETTERS
    ****************************************/

    /**
     * @dev Gets the most recent Static Balance (bias) for a user
     * @param _addr User for which to retrieve static balance
     * @return uint256 balance
     */
    function staticBalanceOf(address _addr)
        public
        view
        returns (uint256)
    {
        uint256 uepoch = userPointEpoch[_addr];
        if(uepoch == 0 || userPointHistory[_addr][uepoch].bias == 0){
            return 0;
        }
        return _staticBalance(userPointHistory[_addr][uepoch].slope, userPointHistory[_addr][uepoch].ts, locked[_addr].end);
    }

    function _staticBalance(int128 _slope, uint256 _startTime, uint256 _endTime)
        internal
        pure
        returns (uint256)
    {
        if(_startTime > _endTime) return 0;
        // get lockup length (end - point.ts)
        uint256 lockupLength = _endTime.sub(_startTime);
        // s = amount * sqrt(length)
        uint256 s = uint256(_slope.mul(10000)).mul(Root.sqrt(lockupLength));
        return s;
    }

    /**
     * @dev Gets the RewardsToken
     */
    function getRewardToken()
        external
        view
        returns (IERC20)
    {
        return stakingToken;
    }

    /**
     * @dev Gets the duration of the rewards period
     */
    function getDuration()
        external
        pure
        returns (uint256)
    {
        return WEEK;
    }

    /**
     * @dev Gets the last applicable timestamp for this reward period
     */
    function lastTimeRewardApplicable()
        public
        view
        returns (uint256)
    {
        return StableMath.min(block.timestamp, periodFinish);
    }

    /**
     * @dev Calculates the amount of unclaimed rewards per token since last update,
     * and sums with stored to give the new cumulative reward per token
     * @return 'Reward' per staked token
     */
    function rewardPerToken()
        public
        view
        returns (uint256)
    {
        // If there is no StakingToken liquidity, avoid div(0)
        uint256 totalStatic = totalStaticWeight;
        if (totalStatic == 0) {
            return rewardPerTokenStored;
        }
        // new reward units to distribute = rewardRate * timeSinceLastUpdate
        uint256 rewardUnitsToDistribute = rewardRate.mul(lastTimeRewardApplicable().sub(lastUpdateTime));
        // new reward units per token = (rewardUnitsToDistribute * 1e18) / totalTokens
        uint256 unitsToDistributePerToken = rewardUnitsToDistribute.divPrecisely(totalStatic);
        // return summed rate
        return rewardPerTokenStored.add(unitsToDistributePerToken);
    }

    /**
     * @dev Calculates the amount of unclaimed rewards a user has earned
     * @param _addr User address
     * @return Total reward amount earned
     */
    function earned(address _addr)
        public
        view
        returns (uint256)
    {
        // current rate per token - rate user previously received
        uint256 userRewardDelta = rewardPerToken().sub(userRewardPerTokenPaid[_addr]);
        // new reward = staked tokens * difference in rate
        uint256 userNewReward = staticBalanceOf(_addr).mulTruncate(userRewardDelta);
        // add to previous rewards
        return rewards[_addr].add(userNewReward);
    }


    /***************************************
                REWARDS - ADMIN
    ****************************************/

    /**
     * @dev Notifies the contract that new rewards have been added.
     * Calculates an updated rewardRate based on the rewards in period.
     * @param _reward Units of RewardToken that have been added to the pool
     */
    function notifyRewardAmount(uint256 _reward)
        external
        onlyRewardsDistributor
        contractNotExpired
        updateReward(address(0))
    {
        uint256 currentTime = block.timestamp;
        // If previous period over, reset rewardRate
        if (currentTime >= periodFinish) {
            rewardRate = _reward.div(WEEK);
        }
        // If additional reward to existing period, calc sum
        else {
            uint256 remaining = periodFinish.sub(currentTime);
            uint256 leftover = remaining.mul(rewardRate);
            rewardRate = _reward.add(leftover).div(WEEK);
        }

        lastUpdateTime = currentTime;
        periodFinish = currentTime.add(WEEK);

        emit RewardAdded(_reward);
    }
}
