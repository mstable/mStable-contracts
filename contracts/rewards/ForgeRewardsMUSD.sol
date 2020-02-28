pragma solidity ^0.5.16;

import { IForgeRewards } from "./IForgeRewards.sol";
import { MassetRewards } from "./MassetRewards.sol";

import { MassetHelpers } from "../masset/shared/MassetHelpers.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { IMetaToken } from "../interfaces/IMetaToken.sol";

import { StableMath } from "../shared/StableMath.sol";
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
contract ForgeRewardsMUSD is MassetRewards, IForgeRewards {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    constructor(IMasset _mUSD, IMetaToken _MTA, address _governor)
        public
        MassetRewards(_mUSD, _MTA, _governor)
    {
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
     *      bAsset used in the mint must be first transferred here from msg.sender, before
     *      being approved for spending by the mUSD contract
     * @param _basset             bAsset address that will be used as minting collateral
     * @param _bassetQuantity     Quantity of the above basset
     * @param _massetRecipient    Address to which the newly minted mUSD will be sent
     * @param _rewardRecipient    Address to which the rewards will be attributed
     * @return massetMinted       Units of mUSD that were minted
     */
    function mintTo(
        address _basset,
        uint256 _bassetQuantity,
        address _massetRecipient,
        address _rewardRecipient
    )
        external
        returns (uint256 massetMinted)
    {
        // Receive the bAsset
        uint256 receivedQty = MassetHelpers.transferTokens(msg.sender, address(this), _basset, true, _bassetQuantity);

        // Mint the mAsset
        massetMinted = mUSD.mintTo(_basset, receivedQty, _massetRecipient);

        // Log minting volume
        _logMintVolume(massetMinted, _rewardRecipient);
    }


    /**
     * @dev Mint mUSD to a specified recipient and then log the minted quantity to rewardee.
     *      bAssets used in the mint must be first transferred here from msg.sender, before
     *      being approved for spending by the mUSD contract
     * @param _bassetQuantities   bAsset quantities that will be used during the mint (ordered as per Basket composition)
     * @param _massetRecipient    Address to which the newly minted mUSD will be sent
     * @param _rewardRecipient    Address to which the rewards will be attributed
     * @return massetMinted       Units of mUSD that were minted
     */
    function mintMulti(
        uint32 _bAssetBitmap,
        uint256[] calldata _bassetQuantities,
        address _massetRecipient,
        address _rewardRecipient
    )
        external
        returns (uint256 massetMinted)
    {
        uint256 inputLength = _bassetQuantities.length;
        address[] memory bAssetAddresses = mUSD.convertBitmapToBassetsAddress(_bAssetBitmap, uint8(inputLength));
        uint256[] memory receivedQty = new uint256[](inputLength);

        for(uint256 i = 0; i < inputLength; i++) {
            if(_bassetQuantities[i] > 0){
                // Transfer the bAssets from sender to rewards contract
                receivedQty[i] = MassetHelpers.transferTokens(msg.sender, address(this), bAssetAddresses[i], true, _bassetQuantities[i]);
            }
        }
        // Do the mUSD mint
        massetMinted = mUSD.mintMulti(_bAssetBitmap, receivedQty, _massetRecipient);

        // Log volume of minting
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

        // Add to total points count
        _logNewTotalPoints(trancheNumber, _volume);

        // Log individual reward
        _logIndividualPoints(trancheNumber, _rewardee, _volume);
    }

}
