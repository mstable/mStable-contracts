pragma solidity ^0.5.12;

import { IMassetForgeRewards } from "./IMassetForgeRewards.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { StableMath } from "../../shared/math/StableMath.sol";
import { IERC20 } from "node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";


/**
 * @title ForgeRewards
 * @dev Forge wrapper that rewards minters for their contribution to liquidity
 *
 *
 * > Ulimited tranches @ x week intervals starting from contract launch (tranche# == date-startDate/tranchePeriod)
 *  > Certain authority called the 'RewardsGovernor'
 *  > 'FundTranche' function that funds a given tranche (MUST BE DONE BEFORE (ideally) OR DURING A TRANCHE PERIOD)
 *    > Sends XXX MTA to load into a given tranche
 * > User mints through 'Rewards' contract
 * > Volume of mint logged in tranche (Tranche number based on timestamp)
 * > At end of tranche, users have 4 weeks to CLAIM their reward (not claimable without funding)
 *  > Claiming reward calculates the payout (f(usersMintVolume, totalMintVolume, trancheFunding))
 *  > Unclaimed rewards are able to be withdrawn by the fund authority and re-used
 *  > Reward locked for 12 months
 *  > Redeem reward
 *
 *
 * MUST HAVE:
 *  - Getters for quickly tallying or projecting rewards
 *  - No ability for Governance to extract the collateral
 *  -
 */
contract ForgeRewardsMUSD is IMassetForgeRewards {

    using StableMath for uint256;

    event RewardeeMintVolumeIncreased(uint256 indexed trancheNumber, address indexed rewardee, uint256 mintVolume);
    event MintVolumeIncreased(uint256 indexed trancheNumber, uint256 mintVolume);
    event RewardClaimed(address indexed minter, uint256 trancheNumber, uint256 rewardAllocation);
    event RewardRedeemed(address indexed minter, uint256 trancheNumber, uint256 rewardAllocation);
    event TrancheFunded(uint256 indexed trancheNumber, uint256 fundAmount);
    event UnclaimedRewardWithdrawn(uint256 indexed trancheNumber, uint256 amountWithdrawn);

    struct Reward {
        uint256 mintVolume;       // Quantity of mUSD the rewardee has logged this tranche
        bool claimed;             // Has the rewardee converted her mintVolume into a reward
        uint256 rewardAllocation; // Quantity of reward the rewardee is allocated
        bool redeemed;            // Has the rewardee redeemed her reward
    }

    struct Tranche {
        uint256 totalMintVolume;      // Total Massets minted in this tranche from all participants

        uint256 totalRewardUnits;     // Total funding received from the rewards Governor
        uint256 unclaimedRewardUnits; // Remaining reward units left unclaimed

        mapping(address => Reward) rewardeeData;
        address[] rewardees;
    }

    struct TrancheDates {
        uint256 startTime;
        uint256 endTime;
        uint256 claimEndTime;
        uint256 unlockTime;
    }

    /** @dev All data for keeping track of rewards */
    mapping(uint256 => Tranche) trancheData;

    /** @dev Core  */
    IMasset public mUSD;
    address public governor;

    uint256 public rewardStartTime;

    uint256 constant public tranchePeriod = 4 weeks;
    uint256 constant public claimPeriod = 8 weeks;
    uint256 constant public lockupPeriod = 52 weeks;

    constructor(IMasset _mUSD, address _governor) public {
        mUSD = _mUSD;
        governor = _governor;
        rewardStartTime = now;
    }

    /***************************************
                    HELPERS
    ****************************************/

    /** @dev Verifies that the caller is the Rewards Governor */
    modifier onlyGovernor() {
        require(governor == msg.sender, "Must be called by the governor");
        _;
    }

    function changeGovernor(address _newGovernor)
    external
    onlyGovernor {
        require(_newGovernor != address(0), "Must be valid address");
        governor = _newGovernor;
    }

    function _currentTrancheNumber() internal view returns(uint256 trancheNumber) {
        uint256 totalTimeElapsed = now.sub(rewardStartTime);
        trancheNumber = totalTimeElapsed.div(tranchePeriod);
    }


    /***************************************
                    FORGING
    ****************************************/

    // Step 1: Mint and log the mint volume
    function mintTo(
        uint256[] calldata _bassetQuantities,
        address _massetRecipient,
        address _rewardRecipient
    )
        external
        returns (uint256 massetMinted)
    {
        // Fetch bAssets from mUSD, compare vs _bassetQuantity
        (address[] memory bAssetAddresses, , , , , ) = mUSD.getBassets();
        require(_bassetQuantities.length == bAssetAddresses.length, "Input array of bAssets must match the system");
        // Loop through _bassetQuantity
        for(uint256 i = 0; i < _bassetQuantities.length; i++) {
            if(_bassetQuantities[i] > 0){
                // Transfer the bAssets from sender to rewards contract
                require(IERC20(bAssetAddresses[i]).transferFrom(msg.sender, address(this), _bassetQuantities[i]),
                    "Minter must approve the spending of bAsset");
                // Approve spending of bAssets to mUSD
                require(IERC20(bAssetAddresses[i]).approve(address(mUSD), _bassetQuantities[i]), "Approval of mUSD failed");
            }
        }

        // Do the mUSD mint
        massetMinted = mUSD.mintTo(_bassetQuantities, _massetRecipient);

        // Log volume of minting
        _logMintVolume(massetMinted, _rewardRecipient);
    }

    function mintSingleTo(
        address _basset,
        uint256 _bassetQuantity,
        address _massetRecipient,
        address _rewardRecipient
    )
        external
        returns (uint256 massetMinted)
    {
        // Option 1: Sender approved this, transfer Bassets here as intermediary, approve mAsset, call mint
        // Option 2: Sender approves mAsset, call mint, mint calls xfer straight from sender. Caveat is that mAsset must
        //           have rewards contract whitelisted. If anyone could call, then anyone with an approved balance would be
        //           subject to robbery
        // Tradeoff == ~20-40k extra gas vs optionality
        require(IERC20(_basset).transferFrom(msg.sender, address(this), _bassetQuantity), "Minter must approve the spending of bAsset");
        require(IERC20(_basset).approve(address(mUSD), _bassetQuantity), "Approval of mUSD failed");

        // Mint the mAsset
        massetMinted = mUSD.mintSingle(_basset, _bassetQuantity, _massetRecipient);

        // Log minting volume
        _logMintVolume(massetMinted, _rewardRecipient);
    }

    function _logMintVolume(
        uint256 _volume,
        address _rewardee
    )
        internal
    {
        // Get current tranche based on timestamp
        uint256 trancheNumber = _currentTrancheNumber();
        Tranche storage tranche = trancheData[trancheNumber];

        // Add to total minting
        tranche.totalMintVolume = tranche.totalMintVolume.add(_volume);
        emit MintVolumeIncreased(trancheNumber, tranche.totalMintVolume);

        // Set individual user rewards
        Reward storage reward = tranche.rewardeeData[_rewardee];
        uint256 currentMintVolume = reward.mintVolume;

        // If this is a new rewardee, add it to array
        if(currentMintVolume == 0){
            tranche.rewardees.push(_rewardee);
        }
        reward.mintVolume = currentMintVolume.add(_volume);
        emit RewardeeMintVolumeIncreased(trancheNumber, _rewardee, reward.mintVolume);
    }

    /***************************************
                    CLAIMING
    ****************************************/

    /** Participant actions to claim tranche rewards */
    function claimReward(uint256 _trancheNumber)
    external
    returns(bool claimed) {
        return claimReward(_trancheNumber, msg.sender);
    }
    function claimReward(uint256 _trancheNumber, address _rewardee)
    public
    returns(bool claimed) {
        Tranche storage tranche = trancheData[_trancheNumber];
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        require(now > trancheDates.endTime && now < trancheDates.claimEndTime, "Reward must be in claim period");
        require(tranche.totalRewardUnits > 0, "Tranche must be funded before claiming can begin");
        Reward storage reward = tranche.rewardeeData[_rewardee];
        require(reward.mintVolume > 0, "Rewardee must have minted something to be eligable");
        require(!reward.claimed, "Reward has already been claimed");

        // Relative reward is calculated a percentage of total mint
        // e.g. (1,000e18 * 1e18)/1,000,000e18 == 0.1% or 1e15
        uint256 rewardeeRelativeMintVolume = reward.mintVolume.divPrecisely(tranche.totalMintVolume);
        // Allocation is calculated as relative volume * total reward units
        // e.g. (1e15 * 100,000e18)/1e18 = 100e18
        reward.rewardAllocation = rewardeeRelativeMintVolume.mulTruncate(tranche.totalRewardUnits);
        reward.claimed = true;
        tranche.unclaimedRewardUnits = tranche.unclaimedRewardUnits.sub(reward.rewardAllocation);
        return true;
    }

    // function redeemReward(uint256 _trancheNumber) external;
    // function redeemRewards(uint256[] calldata _trancheNumbers) external;


    /***************************************
                    FUNDING
    ****************************************/
    /** Governor actions to manage tranche rewards */
    // function fundTranche(uint256 _trancheNumber, uint256 _fundQuantity) external;
    // function withdrawUnclaimedRewards(uint256 _trancheNumber) external;


    /***************************************
                    GETTERS
    ****************************************/

    function _getTrancheDates(uint256 _trancheNumber)
    internal
    view
    returns (
        TrancheDates memory trancheDates
    ) {
        // Tranche memory tranche = trancheData[_trancheNumber];
        // StartTime = contractStart + (# * period)
        // e.g. 300 + (0 * 50) = 300
        // e.g. 300 + (2 * 50) = 400
        trancheDates.startTime = rewardStartTime.add(_trancheNumber.mul(tranchePeriod));
        // EndTime = startTime + length of tranche period
        // e.g. 300 + 50 = 350
        trancheDates.endTime = trancheDates.startTime.add(tranchePeriod);
        // ClaimEndTime = endTime + claimPeriod
        // e.g. 350 + 100 = 450
        trancheDates.claimEndTime = trancheDates.endTime.add(claimPeriod);
        // unlockTime = endTime + lockupPeriod
        // e.g. 350 + 650 = 1000
        trancheDates.unlockTime = trancheDates.endTime.add(lockupPeriod);
    }

    /** Getters for accessing nested tranche data */
    // function getTrancheData(uint256 _trancheNumber)
    //     external returns(
    //         uint256 startTime,
    //         uint256 endTime,
    //         uint256 unlockTime,
    //         uint256 totalMintVolume,
    //         uint256 totalRewardUnits,
    //         uint256 unclaimedRewardUnits,
    //         address[] memory participants);

    // /** Getters for easily parsing all rewardee data */
    // function getParticipantData(uint256 _trancheNumber, address _participant)
    //     external returns(
    //         bool mintWindowClosed,
    //         bool claimWindowClosed,
    //         bool unlocked,
    //         uint256 mintVolume,
    //         bool claimed,
    //         uint256 rewardAllocation,
    //         bool redeemed);
    // function getParticipantData(uint256[] calldata _trancheNumber, address _participant)
    //     external returns(
    //         bool[] memory mintWindowClosed,
    //         bool[] memory claimWindowClosed,
    //         bool[] memory unlocked,
    //         uint256[] memory mintVolume,
    //         bool[] memory claimed,
    //         uint256[] memory rewardAllocation,
    //         bool[] memory redeemed);
    // function getParticipantsData(uint256 _trancheNumber, address[] calldata _participant)
    //     external returns(
    //         uint256[] memory mintVolume,
    //         bool[] memory claimed,
    //         uint256[] memory rewardAllocation,
    //         bool[] memory redeemed);
}
