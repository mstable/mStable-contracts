// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { ISavingsContractV3 } from "../interfaces/ISavingsContract.sol";
import "../interfaces/ITokenLocker.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { StableMath } from "../shared/StableMath.sol";

/// @title TokenLocker Contract utilizing mStable's SavingsContract
/// @author mStable-Test
/// @notice TokenLocker Contract allows user to lock underlying collateral for interest bearing NFTs
contract TokenLocker is
    ITokenLocker,
    ERC721,
    Ownable,
    ReentrancyGuard
{
    using StableMath for uint256;

    // Core events for deposit and withdraw
    event Deposit(address indexed user, uint256 indexed lockerId, uint256 amount);
    event Withdraw(address indexed user, uint256 lockerId, uint256 creditsRedeemed, uint256 payout);
    // Batch Execute Event
    event BatchCleared(
        address indexed clearer,
        uint256 collateralDeposited,
        uint256 creditsReceived,
        uint256 lastBatchedLockerId
    );
    // Fire this event when Batch volume is reached
    event BatchIt(uint256 toBeBatchedCollateral);

    using Counters for Counters.Counter;
    // To keep track of lockerId which is same as NFT tokenId
    Counters.Counter private _lockerIdCounter;

    // Savings Contract for the Locker
    ISavingsContractV3 public immutable savingsContract;
    // Lock period
    uint256 public immutable lockPeriod;
    // Batching Threshold
    uint256 public immutable batchingThreshold;

    // mAsset collateral of locker
    mapping(uint256 => uint256) public lockerCollateral;
    // imCredits of the locker
    mapping(uint256 => uint256) public lockerCredits;
    // maturityTime of locker
    mapping(uint256 => uint256) public lockerMaturity;

    // Last Locker Id to be included in BatchExecute
    uint256 public lastBatchedLockerId;
    // Last time batchExecute was called
    uint256 public lastBatchedTime;
    // Total Collateral to be deposited to
    uint256 public toBeBatchedCollateral;

    // Total collateral deposited by users
    // For internal calculation basis just in case anyone can force send the collateral
    // and invalidate invariants
    uint256 public totalCollateral;

    constructor(
        string memory _name,
        string memory _symbol,
        address _savingsContract,
        uint256 _lockPeriod,
        uint256 _batchingThreshold
    ) ERC721(_name, _symbol) {
        require(_savingsContract != address(0), "SavingsContract Address is Zero");
        savingsContract = ISavingsContractV3(_savingsContract);
        lockPeriod = _lockPeriod;
        batchingThreshold = _batchingThreshold;
    }

    // Is msg.sender Locker Owner
    modifier isLockerOwner(uint256 _lockerId) {
        require(ownerOf(_lockerId) == msg.sender, "Must Own Locker");
        _;
    }

    // Is Locker Matured for withdraw
    modifier isLockerMatured(uint256 _lockerId) {
        require(lockerMaturity[_lockerId] < block.timestamp, "Locker not matured");
        _;
    }

    /// @notice lock mAsset amount and mint interest bearing NFT
    /// @dev tracking tobeBatchedCollateral in here to emit actionalble events
    /// @param _amount Amount of mAsset to lock
    function lock(uint256 _amount) external override returns (uint256) {
        require(_amount > 0, "Must deposit something");
        // Transfer the mAssest to this contract
        require(
            _getMAsset().transferFrom(msg.sender, address(this), _amount),
            "Must deposit tokens"
        );

        // Create new Locker
        uint256 lockerId = _lockerIdCounter.current();
        // Set Locker Collateral
        lockerCollateral[lockerId] = _amount;
        // Set Locker Maturity Date
        lockerMaturity[lockerId] = block.timestamp + lockPeriod;
        // Increment Total outstanding collateral that is to be batched
        toBeBatchedCollateral += _amount;
        // Increment totalCollateral received by this contract
        totalCollateral += _amount;

        // Mint the locker as an NFT to the owner
        _mintLocker(msg.sender);

        emit Deposit(msg.sender, lockerId, _amount);

        // Check if Batching threshold reached
        if (toBeBatchedCollateral >= batchingThreshold) {
            // Emit event to automate batching
            emit BatchIt(toBeBatchedCollateral);
        }

        return lockerId;
    }

    /// @notice Close the locker and collect the payout once its matured
    /// @dev nonReentrant used to protect against Reentrancy
    /// @param _lockerId locker that is to be closed
    /// @return payout amount of mAsset sent to locker owner
    function withdraw(uint256 _lockerId)
        external
        override
        isLockerOwner(_lockerId)
        isLockerMatured(_lockerId)
        nonReentrant
        returns (uint256 payout)
    {
        // Redeem Credits from savingsContract
        uint256 totalPayout = savingsContract.redeemCredits(lockerCredits[_lockerId]);

        // Transfer Payout to locker Owner
        require(_getMAsset().transfer(ownerOf(_lockerId), totalPayout), "Payout transfer to owner failed");

        emit Withdraw(msg.sender, _lockerId, lockerCredits[_lockerId], totalPayout);

        // Delete Locker
        delete lockerCollateral[_lockerId];
        delete lockerCredits[_lockerId];
        delete lockerMaturity[_lockerId];

        // Burn Locker NFT
        // TODO- not working to be checked later - send to savingsContract
        //_burn(_lockerId);
        transferFrom(msg.sender, address(savingsContract), _lockerId);

        return totalPayout;
    }

    /// @notice Batch Deposit all the toBeBatchedCollateral to Savings Contract and distribute credits
    /// @dev little extra credits to the last depositor this batch due to round offs. 
    /// Intentionally leaving toBeBatchedCollateral > batchingThreshold check
    function batchExecute() external override {
        // memory variables to save gas on storage reads
        uint256 currentLockerId = totalLockersCreated();
        uint256 accumulatedCollateral = toBeBatchedCollateral;

        require(currentLockerId > 0, "No Lockers Created yet");
        require(accumulatedCollateral > 0, "No collateral outstanding");
        

        // Refresh allowance if below accumulatedCollateral
        if (_getMAsset().allowance(address(this), address(savingsContract)) <  accumulatedCollateral) {
            _getMAsset().approve(address(savingsContract), ~uint256(0));
        }

        // deposit the last gathered Collateral to Savings Contract and mint credits to this Contract
        uint256 creditsReceived = savingsContract.depositSavings(
            accumulatedCollateral,
            address(this)
        );

        uint256 lastCreatedLockerId = currentLockerId - 1;
        uint256 allotedCredits = 0;

        // distribute credits to lockers of this batch
        // lockerCredits = lockerCollateral / totalCollateral * totalCredits
        for (uint256 i = lastBatchedLockerId + 1; i < lastCreatedLockerId; i++) {
            // Ratio of this locker's collateral to outstanding collateral
            uint256 collateralRatio = lockerCollateral[i].divPrecisely(accumulatedCollateral);
            // Set credits based on collateralRatio
            lockerCredits[i] = collateralRatio.mulTruncate(creditsReceived);
            allotedCredits += lockerCredits[i];
        }
        // last one get a little extra because of truncation delta
        lockerCredits[lastCreatedLockerId] = creditsReceived - allotedCredits;

        emit BatchCleared(msg.sender, accumulatedCollateral, creditsReceived, lastCreatedLockerId);

        // Reset accumulated collateral
        toBeBatchedCollateral = 0;
        // Set Last batched Locker Id to current
        lastBatchedLockerId = lastCreatedLockerId;
        // Update Batched Time
        lastBatchedTime = block.timestamp;
    }

    /// @dev Get the underlying mAsset of the savings contract
    /// @return mAsset Underlying asset contract
    function _getMAsset() internal view returns (IERC20 mAsset) {
        return savingsContract.underlying();
    }

    function _mintLocker(address to) internal {
        uint256 lockerId = _lockerIdCounter.current();
        _lockerIdCounter.increment();
        _mint(to, lockerId);
    }

    function totalLockersCreated() public view returns (uint256) {
        return _lockerIdCounter.current();
    }
}
