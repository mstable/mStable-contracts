pragma solidity 0.5.16;

import { IForgeRewards } from "../rewards/IForgeRewards.sol";
import { MassetHelpers } from "../masset/shared/MassetHelpers.sol";
import { IMasset } from "../interfaces/IMasset.sol";

import { StableMath } from "../shared/StableMath.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title Integration example
 *
 *
 * TODO -> Make this into an implementable contract with a ruleset
 *         for integration partners to follow. Expose generic methods
 */
contract Integration {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    IMasset public musd; // Masset to mint
    IForgeRewards public rewards; // Middleman to minting
    IERC20 public mta; // Fee token

    constructor(IMasset _mUSD, IForgeRewards _rewards, IERC20 _MTA)
      public {
        musd = _mUSD;
        rewards = _rewards;
        mta = _MTA;

        // To mint and earn rewards, we need to approve the rewards contract to spend
        // bAssets. This reduces gas costs in tx
        approveAllBassets();

        // To redeem (directly with mUSD contract) we need to allow it to take the MTA fee
        MassetHelpers.approveMTA(_MTA, address(_mUSD));
    }

    /**
     * @dev Approve max tokens for mUSD contract for each bAsset
     */
    function approveAllBassets() public {
        MassetHelpers.approveAllBassets(musd, address(rewards));
    }

    /***************************************
                    FORGING
    ****************************************/

    /**
     * @dev One
     */
    function mintWithETH(
        address _basset
    )
        external
        returns (uint256 massetMinted)
    {
        // Receive the bAsset
        // uint256 receivedQty = MassetHelpers.transferTokens(msg.sender, address(this), _basset, true, _bassetQuantity);

        // Mint the mAsset
        // massetMinted = mUSD.mintTo(_basset, receivedQty, _massetRecipient);
    }

    /**
     * @dev One
     */
    function redeemToETH(
        uint256 _mAssetAmount,
        address _bAsset
    )
        external
        returns (uint256 massetMinted)
    {
        // 1. Receive the mAsset
        // 2. Calc and receive the payable fee
        // 3. Do the redemption into specified bAsset (likely calc'd elsewhere based on price)
        // 4. Sell bAsset for ETH and send back to redeemer
    }

    /**
     * @dev Receives mUSD, calcs fee, purchases on Kyber (mUSD <> MTA), redeems into bAsset, sends to user
     */
    function redeemWithoutFee(
        uint256 _mAssetAmount,
        address _bAsset
    )
        external
        returns (uint256 massetMinted)
    {
        // 1. Receive mUSD
        // 2. Calc fee (tricky calculate to get 100% utilisation)
        // 3. Purchase on Kyber (mUSD <> MTA)
        // 4. Redeem into bAsset and send back to user
    }

    /**
     * @dev Takes a flash loan for one bAsset (inputBasset), mints mUSD then sells for inputBasset and keeps delta
     */
    function flashArbitrage(
        address _inputBasset,
        uint256 _loanSize
    )
        external
    {
    }

    /**
     * @dev Takes a flash loan for one bAsset (inputBasset), mints mUSD, redeems outputBasset, then sells for input bAsset
     * and keeps the remainder
     */
    function flashRebalance(
        address _inputBasset,
        uint256 _loanSize,
        address _outputBasset
    )
        external
    {
    }



}
