pragma solidity ^0.5.12;

import { IMassetForgeRewards } from "./IMassetForgeRewards.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { ISystok } from "../../interfaces/ISystok.sol";
import { IERC20 } from "node_modules/openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

import { StableMath } from "../../shared/math/StableMath.sol";

import { ReentrancyGuard } from "../../shared/ReentrancyGuard.sol";


/**
 * @title ForgeRewards
 * @dev Forge wrapper that rewards minters for their contribution to liquidity
 */
contract ForgeRewardsMUSD is IMassetForgeRewards, ReentrancyGuard {

    using StableMath for uint256;

    event RewardeeMintVolumeIncreased(uint256 indexed trancheNumber, address indexed rewardee, uint256 mintVolume);
    event MintVolumeIncreased(uint256 indexed trancheNumber, uint256 mintVolume);
    event RewardClaimed(address indexed rewardee, uint256 trancheNumber, uint256 rewardAllocation);
    event RewardRedeemed(address indexed rewardee, uint256 trancheNumber, uint256 rewardAllocation);
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
        uint256 startTime;      // Timestamp that minting opens for this tranche
        uint256 endTime;        // Timestamp that minting ends for this tranche
        uint256 claimEndTime;   // Timestamp that claims finish for the tranche
        uint256 unlockTime;     // Timestamp that the rewarded tokens become unlocked
    }

    /** @dev All data for keeping track of rewards */
    mapping(uint256 => Tranche) trancheData;

    /** @dev Core connections */
    IMasset public mUSD;
    ISystok public MTA;

    /** @dev Governor is responsible for funding the tranches */
    address public governor;

    /** @dev Timestamp of the initialisation of rewards (start of the contract) */
    uint256 public rewardStartTime;

    /** @dev Constant timestamps on the tranche data */
    uint256 constant public tranchePeriod = 4 weeks;
    uint256 constant public claimPeriod = 8 weeks;
    uint256 constant public lockupPeriod = 52 weeks;

    constructor(IMasset _mUSD, ISystok _MTA, address _governor) public {
        mUSD = _mUSD;
        MTA = _MTA;
        governor = _governor;
        rewardStartTime = now;
    }

    /***************************************
                  GOVERNANCE
    ****************************************/

    /** @dev Verifies that the caller is the Rewards Governor */
    modifier onlyGovernor() {
        require(governor == msg.sender, "Must be called by the governor");
        _;
    }

    /** @dev Rewards governor can choose another governor to fund the tranches */
    function changeGovernor(address _newGovernor)
    external
    onlyGovernor {
        require(_newGovernor != address(0), "Must be valid address");
        governor = _newGovernor;
    }


    /***************************************
                    FORGING
    ****************************************/

    /**
     * @dev
     * @param _bassetQuantities
     * @param _massetRecipient
     * @param _rewardRecipient
     * @return massetMinted
     */
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

    /**
     * @dev
     * @param _basset
     * @param _bassetQuantity
     * @param _massetRecipient
     * @param _rewardRecipient
     * @return massetMinted
     */
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

    /**
     * @dev
     * @param _volume
     * @param _rewardee
     */
    function _logMintVolume(
        uint256 _volume,
        address _rewardee
    )
        internal
        nonReentrant
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

    /**
     * @dev
     * @param _trancheNumber
     * @return claimed
     */
    function claimReward(uint256 _trancheNumber)
    external
    returns(bool claimed) {
        return claimReward(_trancheNumber, msg.sender);
    }

    /**
     * @dev
     * @param _trancheNumber
     * @param _rewardee
     * @return claimed
     */
    function claimReward(uint256 _trancheNumber, address _rewardee)
    public
    nonReentrant
    returns(bool claimed) {
        Tranche storage tranche = trancheData[_trancheNumber];
        require(tranche.totalRewardUnits > 0, "Tranche must be funded before claiming can begin");

        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        require(now > trancheDates.endTime && now < trancheDates.claimEndTime, "Reward must be in claim period");

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

        emit RewardClaimed(_rewardee, _trancheNumber, reward.rewardAllocation);
        return true;
    }

    /**
     * @dev
     * @param _trancheNumber
     * @return redeemed
     */
    function redeemReward(uint256 _trancheNumber)
    external
    returns(bool redeemed) {
        return redeemReward(_trancheNumber, msg.sender);
    }

    /**
     * @dev
     * @param _trancheNumber
     * @param _rewardee
     * @return redeemed
     */
    function redeemReward(uint256 _trancheNumber, address _rewardee)
    public
    nonReentrant
    returns(bool redeemed) {
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        require(now > trancheDates.unlockTime, "Reward must be unlocked");

        Reward storage reward = trancheData[_trancheNumber].rewardeeData[_rewardee];
        require(reward.claimed, "Rewardee must have originally claimed their reward");
        require(reward.rewardAllocation > 0, "Rewardee must have some allocation to redeem");
        require(!reward.redeemed, "Reward has already been redeemed");

        reward.redeemed = true;
        require(MTA.transfer(_rewardee, reward.rewardAllocation), "Rewardee must receive reward");

        emit RewardRedeemed(_rewardee, _trancheNumber, reward.rewardAllocation);
        return true;
    }


    /***************************************
                    FUNDING
    ****************************************/

    /**
     * @dev
     * @param _trancheNumber
     * @param _fundQuantity
     */
    function fundTranche(uint256 _trancheNumber, uint256 _fundQuantity)
    external
    onlyGovernor {
        Tranche storage tranche = trancheData[_trancheNumber];
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);

        // If the tranche has already closed, the only circumstances the reward may be added
        // is if the current funding is 0, and the claim period has not yet elapsed
        // This is for backup circumstances in the event that the tranche was not funded in time
        if(now > trancheDates.endTime){
            require(tranche.totalRewardUnits == 0, "Cannot increase reward units after end time");
            require(now < trancheDates.claimEndTime, "Cannot fund tranche after the claim period");
        }

        require(MTA.transferFrom(governor, address(this), _fundQuantity), "Governor must send the funding MTA");
        tranche.totalRewardUnits = tranche.totalRewardUnits.add(_fundQuantity);
        tranche.unclaimedRewardUnits = tranche.totalRewardUnits;

        emit TrancheFunded(_trancheNumber, tranche.totalRewardUnits);
    }

    /**
     * @dev
     * @param _trancheNumber
     */
    function withdrawUnclaimedRewards(uint256 _trancheNumber)
    external
    onlyGovernor {
        Tranche storage tranche = trancheData[_trancheNumber];
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);

        require(now > trancheDates.claimEndTime, "Claim period must have elapsed");
        require(tranche.unclaimedRewardUnits > 0, "Tranche must contain unclaimed reward units");

        tranche.unclaimedRewardUnits = 0;
        require(MTA.transfer(governor, tranche.unclaimedRewardUnits), "Governor must receive the funding MTA");

        emit UnclaimedRewardWithdrawn(_trancheNumber, tranche.totalRewardUnits);
    }


    /***************************************
              GETTERS - INTERNAL
    ****************************************/

    /**
     * @dev Internal helper to fetch the current tranche number based on the timestamp
     * @return trancheNumber starting with 0
     */
    function _currentTrancheNumber() internal view returns(uint256 trancheNumber) {
        // e.g. now (1000), startTime (600), tranchePeriod (150)
        // (1000-600)/150 = 2
        // e.g. now == 650 => 50/150 = 0
        uint256 totalTimeElapsed = now.sub(rewardStartTime);
        trancheNumber = totalTimeElapsed.div(tranchePeriod);
    }

    /**
     * @dev
     * @param _trancheNumber
     * @return trancheDates
     */
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


    /***************************************
              GETTERS - EXTERNAL
    ****************************************/

    /**
     * @dev
     * @param _trancheNumber
     * @return startTime
     * @return endTime
     * @return claimEndTime
     * @return unlockTime
     * @return totalMintVolume
     * @return totalRewardUnits
     * @return unclaimedRewardUnits
     * @return rewardees
     */
    function getTrancheData(uint256 _trancheNumber)
    external
    view
    returns (
        uint256 startTime,
        uint256 endTime,
        uint256 claimEndTime,
        uint256 unlockTime,
        uint256 totalMintVolume,
        uint256 totalRewardUnits,
        uint256 unclaimedRewardUnits,
        address[] memory rewardees
    ) {
        Tranche memory tranche = trancheData[_trancheNumber];
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        return (
          trancheDates.startTime,
          trancheDates.endTime,
          trancheDates.claimEndTime,
          trancheDates.unlockTime,
          tranche.totalMintVolume,
          tranche.totalRewardUnits,
          tranche.unclaimedRewardUnits,
          tranche.rewardees
        );
    }

    /**
     * @dev
     * @param _trancheNumber
     * @param _rewardee
     * @return mintWindowClosed
     * @return claimWindowClosed
     * @return unlocked
     * @return mintVolume
     * @return claimed
     * @return rewardAllocation
     * @return redeemed
     */
    function getRewardeeData(uint256 _trancheNumber, address _rewardee)
    external
    view
    returns (
        bool mintWindowClosed,
        bool claimWindowClosed,
        bool unlocked,
        uint256 mintVolume,
        bool claimed,
        uint256 rewardAllocation,
        bool redeemed
    ) {
        Reward memory reward = trancheData[_trancheNumber].rewardeeData[_rewardee];
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        return (
          now > trancheDates.endTime,
          now > trancheDates.claimEndTime,
          now > trancheDates.unlockTime,
          reward.mintVolume,
          reward.claimed,
          reward.rewardAllocation,
          reward.redeemed
        );
    }

    /**
     * @dev
     * @param _trancheNumbers
     * @param _rewardee
     * @return mintWindowClosed
     * @return claimWindowClosed
     * @return unlocked
     * @return mintVolume
     * @return claimed
     * @return rewardAllocation
     * @return redeemed
     */
    function getRewardeeData(uint256[] calldata _trancheNumbers, address _rewardee)
    external
    view
    returns(
        bool[] memory mintWindowClosed,
        bool[] memory claimWindowClosed,
        bool[] memory unlocked,
        uint256[] memory mintVolume,
        bool[] memory claimed,
        uint256[] memory rewardAllocation,
        bool[] memory redeemed
    ) {
        uint256 len = _trancheNumbers.length;
        for(uint256 i = 0; i < len; i++){
            TrancheDates memory trancheDates = _getTrancheDates(_trancheNumbers[i]);
            Reward memory reward = trancheData[_trancheNumbers[i]].rewardeeData[_rewardee];
            mintWindowClosed[i] = now > trancheDates.endTime;
            claimWindowClosed[i] = now > trancheDates.claimEndTime;
            unlocked[i] = now > trancheDates.unlockTime;
            mintVolume[i] = reward.mintVolume;
            claimed[i] = reward.claimed;
            rewardAllocation[i] = reward.rewardAllocation;
            redeemed[i] = reward.redeemed;
        }
    }

    /**
     * @dev
     * @param _trancheNumber
     * @param _rewardees
     * @return mintVolume
     * @return claimed
     * @return rewardAllocation
     * @return redeemed
     */
    function getRewardeesData(uint256 _trancheNumber, address[] calldata _rewardees)
    external
    view
    returns(
        uint256[] memory mintVolume,
        bool[] memory claimed,
        uint256[] memory rewardAllocation,
        bool[] memory redeemed
    ) {
        uint256 len = _rewardees.length;
        for(uint256 i = 0; i < len; i++){
            Reward memory reward = trancheData[_trancheNumber].rewardeeData[_rewardees[i]];
            mintVolume[i] = reward.mintVolume;
            claimed[i] = reward.claimed;
            rewardAllocation[i] = reward.rewardAllocation;
            redeemed[i] = reward.redeemed;
        }
    }
}
