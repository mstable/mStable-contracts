// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { IForgeValidator } from "./IForgeValidator.sol";

// Internal
import { Initializable } from "../../../shared/@openzeppelin-2.5/Initializable.sol";
import { InitializableToken } from "../../../shared/InitializableToken.sol";
import { ImmutableModule } from "../../../shared/ImmutableModule.sol";
import { InitializableReentrancyGuard } from "../../../shared/InitializableReentrancyGuard.sol";
import { IMasset, Deprecated_BasketManager } from "../../../interfaces/IMasset.sol";

// Libs
import { StableMath } from "../../../shared/StableMath.sol";
// import { MassetHelpers } from "./shared/MassetHelpers.sol";
// import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
// import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * Masset 2.0 storage for migration to 3.0
 */
contract MassetV2 is
    Initializable,
    InitializableToken,
    ImmutableModule,
    InitializableReentrancyGuard
{
    using StableMath for uint256;

    // Forging Events
    event Minted(address indexed minter, address recipient, uint256 mAssetQuantity, address bAsset, uint256 bAssetQuantity);
    event MintedMulti(address indexed minter, address recipient, uint256 mAssetQuantity, address[] bAssets, uint256[] bAssetQuantities);
    event Swapped(address indexed swapper, address input, address output, uint256 outputAmount, address recipient);
    event Redeemed(address indexed redeemer, address recipient, uint256 mAssetQuantity, address[] bAssets, uint256[] bAssetQuantities);
    event RedeemedMasset(address indexed redeemer, address recipient, uint256 mAssetQuantity);
    event PaidFee(address indexed payer, address asset, uint256 feeQuantity);

    // State Events
    event CacheSizeChanged(uint256 cacheSize);
    event SwapFeeChanged(uint256 fee);
    event RedemptionFeeChanged(uint256 fee);
    event ForgeValidatorChanged(address forgeValidator);
    
    // Modules and connectors
    IForgeValidator public forgeValidator;
    bool private forgeValidatorLocked;
    Deprecated_BasketManager private basketManager;

    // Basic redemption fee information
    uint256 public swapFee;
    uint256 private MAX_FEE;

    // RELEASE 1.1 VARS
    uint256 public redemptionFee;

    // RELEASE 2.0 VARS
    uint256 public cacheSize;
    uint256 public surplus;

    /**
     * @dev Constructor to set immutable bytecode
     * @param _nexus   Nexus address
     */
    constructor(address _nexus) ImmutableModule(_nexus) {}

    /**
      * @dev Gets the address of the BasketManager for this mAsset
      * @return basketManager Address
      */
    function getBasketManager()
        external
        view
        returns (address)
    {
        return address(basketManager);
    }
}
