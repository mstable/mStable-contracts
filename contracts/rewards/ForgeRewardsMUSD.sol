pragma solidity ^0.5.16;

import { IMassetForgeRewards } from "./IMassetForgeRewards.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { ISystok } from "../interfaces/ISystok.sol";
import { StableMath } from "../shared/StableMath.sol";
import { Governable } from "../governance/Governable.sol";

import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title ForgeRewardsMUSD
 * @dev Forge wrapper that rewards minters for their contribution to mUSD liquidity.
 *      Flow is as follows:
 *        - Tranche is funded in MTA by the 'Governor'
 *        - Participants use the mint functions to mint mUSD
 *        - Mint quantity is logged to the specified rewardee in the current tranche
 *        - Tranche period ends, and participants have 8 weeks in which to claim their reward
 *           - Reward allocation is calculated proportionately as f(mintVolume, totalMintVolume, trancheFunding)
 *           - Unclaimed rewards can be retrieved by 'Governor' for future tranches
 *        - Reward allocation is unlocked for redemption after 52 weeks
 */
contract ForgeRewardsMUSD is IMassetForgeRewards, Governable {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    event RewardeeMintVolumeIncreased(uint256 indexed trancheNumber, address indexed rewardee, uint256 mintVolume);
    event MintVolumeIncreased(uint256 indexed trancheNumber, uint256 mintVolume);
    event RewardClaimed(address indexed rewardee, uint256 trancheNumber, uint256 rewardAllocation);
    event RewardRedeemed(address indexed rewardee, uint256 trancheNumber, uint256 rewardAllocation);
    event TrancheFunded(uint256 indexed trancheNumber, uint256 fundAmount);
    event UnclaimedRewardWithdrawn(uint256 indexed trancheNumber, uint256 amountWithdrawn);

    struct Reward {
        /** @dev Quantity of mUSD the rewardee has logged this tranche */
        uint256 mintVolume;
        /** @dev Quantity of reward the rewardee is allocated */
        uint256 rewardAllocation;
        /** @dev Has the rewardee converted her mintVolume into a reward */
        bool claimed;
        /** @dev Has the rewardee redeemed her reward */
        bool redeemed;
    }

    struct Tranche {
        /** @dev Total Massets minted in this tranche from all participants */
        uint256 totalMintVolume;

        /** @dev Total funding received from the rewards Governor */
        uint256 totalRewardUnits;
        /** @dev Remaining reward units left unclaimed */
        uint256 unclaimedRewardUnits;

        mapping(address => Reward) rewardeeData;
        address[] rewardees;
    }

    struct TrancheDates {
        /** @dev Timestamp that minting opens for this tranche */
        uint256 startTime;
        /** @dev Timestamp that minting ends for this tranche */
        uint256 endTime;
        /** @dev Timestamp that claims finish for the tranche */
        uint256 claimEndTime;
        /** @dev Timestamp that the rewarded tokens become unlocked */
        uint256 unlockTime;
    }

    /** @dev All data for keeping track of rewards. Tranche ID starts at 0 (see _currentTrancheNumber) */
    mapping(uint256 => Tranche) private trancheData;

    /** @dev Core connections */
    IMasset public mUSD;
    ISystok public MTA;

    /** @dev Timestamp of the initialisation of rewards (start of the contract) */
    uint256 public rewardStartTime;

    /** @dev Constant timestamps on the tranche data */
    uint256 constant public tranchePeriod = 4 weeks;
    uint256 constant public claimPeriod = 8 weeks;
    uint256 constant public lockupPeriod = 52 weeks;

    constructor(IMasset _mUSD, ISystok _MTA, address _governor) public {
        mUSD = _mUSD;
        MTA = _MTA;
        rewardStartTime = now;
        _changeGovernor(_governor);
        approveAllBassets();
    }

    /***************************************
                    APPROVAL
    ****************************************/

    /**
     * @dev Approve max tokens for mUSD contract for each bAsset
     */
    function approveAllBassets() public {
        address[] memory bAssets = mUSD.getAllBassetsAddress();
        for(uint256 i = 0; i < bAssets.length; i++) {
            approveFor(bAssets[i], uint256(-1));
        }
    }

    /**
     * @dev Approve max tokens for mUSD contact of a given bAsset token contract
     * @param _bAsset bAsset token address
     */
    function approveFor(address _bAsset, uint256 _amount) public onlyGovernor {
        IERC20(_bAsset).safeIncreaseAllowance(address(mUSD), _amount);
    }

    /***************************************
                    FORGING
    ****************************************/

    /**
     * @dev Mint mUSD to a specified recipient and then log the minted quantity to rewardee.
     *      bAssets used in the mint must be first transferred here from msg.sender, before
     *      being approved for spending by the mUSD contract
     * @param _bassetQuantities   bAsset quantities that will be used during the mint (ordered as per Basket composition)
     * @param _massetRecipient    Address to which the newly minted mUSD will be sent
     * @param _rewardRecipient    Address to which the rewards will be attributed
     * @return massetMinted       Units of mUSD that were minted
     */
    function mintTo(
        uint32 _bAssetBitmap,
        uint256[] calldata _bassetQuantities,
        address _massetRecipient,
        address _rewardRecipient
    )
        external
        returns (uint256 massetMinted)
    {
        address[] memory bAssetAddresses = mUSD.convertBitmapToBassetsAddress(_bAssetBitmap, uint8(_bassetQuantities.length));
        for(uint256 i = 0; i < bAssetAddresses.length; i++) {
            if(_bassetQuantities[i] > 0){
                // Transfer the bAssets from sender to rewards contract
                IERC20(bAssetAddresses[i]).safeTransferFrom(msg.sender, address(this), _bassetQuantities[i]);
            }
        }
        // Do the mUSD mint
        massetMinted = mUSD.mintBitmapTo(_bAssetBitmap, _bassetQuantities, _massetRecipient);

        // Log volume of minting
        _logMintVolume(massetMinted, _rewardRecipient);
    }

    /**
     * @dev Mint mUSD to a specified recipient and then log the minted quantity to rewardee.
     *      bAsset used in the mint must be first transferred here from msg.sender, before
     *      being approved for spending by the mUSD contract
     * @param _basset             bAsset address that will be used as minting collateral
     * @param _bassetQuantity     Quantity of the above basset
     * @param _massetRecipient    Address to which the newly minted mUSD will be sent
     * @param _rewardRecipient    Address to which the rewards will be attributed
     * @return massetMinted       Units of mUSD that were minted
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
        IERC20(_basset).safeTransferFrom(msg.sender, address(this), _bassetQuantity);

        // Mint the mAsset
        massetMinted = mUSD.mintSingleTo(_basset, _bassetQuantity, _massetRecipient);

        // Log minting volume
        _logMintVolume(massetMinted, _rewardRecipient);
    }

    /**
     * @dev Internal function to log the minting contribution
     * @param _volume       Units of mUSD that have been minted, where 1 == 1e18
     * @param _rewardee     Address to which the volume should be attributed
     */
    function _logMintVolume(
        uint256 _volume,
        address _rewardee
    )
        internal
    {
        // Get current tranche based on timestamp
        uint256 trancheNumber = _currentTrancheNumber();

        // Add to total minting
        uint256 newTotalMintVolume = trancheData[trancheNumber].totalMintVolume.add(_volume);
        trancheData[trancheNumber].totalMintVolume = newTotalMintVolume;
        emit MintVolumeIncreased(trancheNumber, newTotalMintVolume);

        // Set individual user rewards
        uint256 currentMintVolume = trancheData[trancheNumber].rewardeeData[_rewardee].mintVolume;

        // If this is a new rewardee, add it to array
        if(currentMintVolume == 0){
            trancheData[trancheNumber].rewardees.push(_rewardee);
        }

        uint256 newMintVolume = currentMintVolume.add(_volume);
        trancheData[trancheNumber].rewardeeData[_rewardee].mintVolume = newMintVolume;
        emit RewardeeMintVolumeIncreased(trancheNumber, _rewardee, newMintVolume);
    }

    /***************************************
                    CLAIMING
    ****************************************/

    /**
     * @dev Allows a rewardee to claim their reward allocation. Reward allocation is calculated
     *      proportionately as f(mintVolume, totalMintVolume, trancheFunding). This must be
     *      called after the tranche period has ended, and before the claim period has elapsed.
     * @param _trancheNumber    Number of the tranche to attempt to claim
     * @return claimed          Bool result of claim
     */
    function claimReward(uint256 _trancheNumber)
    external
    returns(bool claimed) {
        return claimReward(_trancheNumber, msg.sender);
    }

    /**
     * @dev Allows a rewardee to claim their reward allocation. Reward allocation is calculated
     *      proportionately as f(mintVolume, totalMintVolume, trancheFunding). This must be
     *      called after the tranche period has ended, and before the claim period has elapsed.
     * @param _trancheNumber    Number of the tranche to attempt to claim
     * @param _rewardee         Address for which the reward should be claimed
     * @return claimed          Bool result of claim
     */
    function claimReward(uint256 _trancheNumber, address _rewardee)
    public
    returns(bool claimed) {
        Tranche storage tranche = trancheData[_trancheNumber];
        require(tranche.totalRewardUnits > 0, "Tranche must be funded");

        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        require(now > trancheDates.endTime && now < trancheDates.claimEndTime, "Tranche must be in claim period");

        Reward storage reward = tranche.rewardeeData[_rewardee];
        uint256 rewardeeMintVolume = reward.mintVolume;
        require(rewardeeMintVolume > 0, "Rewardee must have minted something");
        require(!reward.claimed, "Reward has already been claimed");

        // Relative reward is calculated a percentage of total mint
        // e.g. (1,000e18 * 1e18)/1,000,000e18 == 0.1% or 1e15
        uint256 rewardeeRelativeMintVolume = rewardeeMintVolume.divPrecisely(tranche.totalMintVolume);
        // Allocation is calculated as relative volume * total reward units
        // e.g. (1e15 * 100,000e18)/1e18 = 100e18
        uint256 allocation = rewardeeRelativeMintVolume.mulTruncate(tranche.totalRewardUnits);
        reward.rewardAllocation = allocation;
        reward.claimed = true;
        tranche.unclaimedRewardUnits = tranche.unclaimedRewardUnits.sub(allocation);

        emit RewardClaimed(_rewardee, _trancheNumber, allocation);
        return true;
    }

    /***************************************
                  REDEMPTION
    ****************************************/

    /**
     * @dev Redemption of the previously claimed reward. Must be called after the lockup
     *      period has elapsed. Only withdraws if the rewardee has > 0 allocated.
     * @param _trancheNumber    Number of the tranche to attempt to redeem
     * @return redeemed         Bool to signal the successful redemption
     */
    function redeemReward(uint256 _trancheNumber)
    external
    returns(bool redeemed) {
        return redeemReward(_trancheNumber, msg.sender);
    }

    /**
     * @dev Redemption of the previously claimed reward. Must be called after the lockup
     *      period has elapsed. Only withdraws if the rewardee has > 0 allocated.
     * @param _trancheNumber    Number of the tranche to attempt to redeem
     * @param _rewardee         Rewardee for whom the redemption should be processed
     * @return redeemed         Bool to signal the successfull redemption
     */
    function redeemReward(uint256 _trancheNumber, address _rewardee)
    public
    returns(bool redeemed) {
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        require(now > trancheDates.unlockTime, "Reward must be unlocked");

        Reward storage reward = trancheData[_trancheNumber].rewardeeData[_rewardee];
        uint256 allocation = reward.rewardAllocation;
        require(reward.claimed, "Rewardee must have claimed reward");
        require(allocation > 0, "Rewardee must have allocation");
        require(!reward.redeemed, "Reward has already been redeemed");

        reward.redeemed = true;
        require(MTA.transfer(_rewardee, allocation), "Rewardee must receive reward");

        emit RewardRedeemed(_rewardee, _trancheNumber, allocation);
        return true;
    }


    /***************************************
                    FUNDING
    ****************************************/

    /**
     * @dev Governor funds the tranche with MTA by sending it to the contract.
     *      Funding times                 Behaviour
     *      Before tranche 'endTime'      Able to add or top up rewards
     *      Between 'endTime' and         Only able to add if current funding == 0
     *              'claimEndTime'
     *      After 'claimEndTime'          No funding allowed
     * @param _trancheNumber    Tranche number to fund (starting at 0)
     * @param _fundQuantity     Amount of MTA to allocate to the tranche
     */
    function fundTranche(uint256 _trancheNumber, uint256 _fundQuantity)
    external
    onlyGovernor
    {
        Tranche storage tranche = trancheData[_trancheNumber];
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);

        // If the tranche has already closed, the only circumstances the reward may be added
        // is if the current funding is 0, and the claim period has not yet elapsed
        // This is for backup circumstances in the event that the tranche was not funded in time
        if(now > trancheDates.endTime){
            require(tranche.totalRewardUnits == 0, "Cannot increase reward units now");
            require(now < trancheDates.claimEndTime, "Funding too late");
        }

        require(MTA.transferFrom(governor(), address(this), _fundQuantity), "Governor must provide MTA");
        tranche.totalRewardUnits = tranche.totalRewardUnits.add(_fundQuantity);
        tranche.unclaimedRewardUnits = tranche.totalRewardUnits;

        emit TrancheFunded(_trancheNumber, tranche.totalRewardUnits);
    }

    /**
     * @dev Allows the governor to withdraw any MTA that has not been claimed
     * @param _trancheNumber  ID of the tranche for which to claim back MTA
     */
    function withdrawUnclaimedRewards(uint256 _trancheNumber)
    external
    onlyGovernor {
        TrancheDates memory trancheDates = _getTrancheDates(_trancheNumber);
        require(now > trancheDates.claimEndTime, "Claim period must have elapsed");

        uint256 unclaimedRewardUnits = trancheData[_trancheNumber].unclaimedRewardUnits;

        require(unclaimedRewardUnits > 0, "Must contain unclaimed rewards");

        trancheData[_trancheNumber].unclaimedRewardUnits = 0;
        require(MTA.transfer(governor(), unclaimedRewardUnits), "Must payout the funding MTA");

        emit UnclaimedRewardWithdrawn(_trancheNumber, unclaimedRewardUnits);
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
     * @dev Gets the relevant start, end, claimEnd and unlock times for a particular tranche.
     *      Tranche number 0 begins at contract start time.
     * @param _trancheNumber    ID of the tranche for which to retrieve dates
     * @return trancheDates     Struct containing accessors for every date
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
     * @dev Basic getter to retrieve all relevant data from the tranche struct and dates
     * @param _trancheNumber          Tranche ID for which to retrieve data
     * @return startTime              Time the Tranche opened for Minting
     * @return endTime                Time the Tranche minting window closed
     * @return claimEndTime           Time the Tranche claim window closed
     * @return unlockTime             Time the rewards for this Tranche unlocked
     * @return totalMintVolume        Total minting volume occurred during Tranche
     * @return totalRewardUnits       Total units of funding provided by governance
     * @return unclaimedRewardUnits   Total units of funding remaining unclaimed
     * @return rewardees              Array of reward participants
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
     * @dev Understand if a rewardee has participated in a tranche
     * @param _trancheNumber        ID of the tranche
     * @param _rewardee             Address of the rewardee
     * @return hasParticipated      Bool to indicate that a rewardee has participated
     */
    function getRewardeeParticipation(uint256 _trancheNumber, address _rewardee)
    external
    view
    returns (
        bool hasParticipated
    ) {
        Reward memory reward = trancheData[_trancheNumber].rewardeeData[_rewardee];
        return reward.mintVolume > 0 || reward.rewardAllocation > 0;
    }


    /**
     * @dev Get data for a particular rewardee at a particular tranche
     * @param _trancheNumber        ID of the tranche
     * @param _rewardee             Address of the rewardee
     * @return mintWindowClosed     Time at which window closed
     * @return claimWindowClosed    Time at which claim window closed
     * @return unlocked             Time the rewards unlocked
     * @return mintVolume           Rewardee mint volume in tranche
     * @return claimed              Bool to signify that the rewardee has claimed
     * @return rewardAllocation     Units of MTA claimed by the rewardee
     * @return redeemed             Bool - has the rewardee withdrawn their reward
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
     * @dev Get rewardee data over an array of tranches
     * @param _trancheNumbers       ID's for all tranches to retrieve
     * @param _rewardee             Rewardee address
     * @return mintWindowClosed     Arr Tranche minting window closed
     * @return claimWindowClosed    Arr Time the claim window closed
     * @return unlocked             Arr Unlock time for tranche
     * @return mintVolume           Arr Rewardees mint volume
     * @return claimed              Arr Rewardee claim bool
     * @return rewardAllocation     Arr Rewardee allocated units of MTA
     * @return redeemed             Arr Redeemed
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

        mintWindowClosed = new bool[](len);
        claimWindowClosed = new bool[](len);
        unlocked = new bool[](len);
        mintVolume = new uint256[](len);
        claimed = new bool[](len);
        rewardAllocation = new uint256[](len);
        redeemed = new bool[](len);

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
     * @dev Get array of rewardees data in a particular tranche
     * @param _trancheNumber        ID of the tranche
     * @param _rewardees            Array of rewardee addresses
     * @return mintVolume           Arr Rewardee mint volume
     * @return claimed              Arr Rewardee claimed
     * @return rewardAllocation     Arr Rewardee allocation
     * @return redeemed             Arr Rewardee redeemed
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
        mintVolume = new uint256[](len);
        claimed = new bool[](len);
        rewardAllocation = new uint256[](len);
        redeemed = new bool[](len);

        for(uint256 i = 0; i < len; i++){
            Reward memory reward = trancheData[_trancheNumber].rewardeeData[_rewardees[i]];
            mintVolume[i] = reward.mintVolume;
            claimed[i] = reward.claimed;
            rewardAllocation[i] = reward.rewardAllocation;
            redeemed[i] = reward.redeemed;
        }
    }
}
