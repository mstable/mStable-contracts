// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

// Internal
import { Initializable } from "../../shared/@openzeppelin-2.5/Initializable.sol";
import { InitializableToken } from "../../shared/InitializableToken.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";
import { IMasset, Deprecated_BasketManager } from "../../interfaces/IMasset.sol";

/**
 * Masset 2.0 storage for migration to 3.0
 */
contract MassetV2 is
    Initializable,
    InitializableToken,
    ImmutableModule,
    InitializableReentrancyGuard
{
    /**
     * @dev Constructor to set immutable bytecode
     * @param _nexus   Nexus address
     */
    constructor(address _nexus) ImmutableModule(_nexus) {}
    
    // Modules and connectors
    address public forgeValidator;
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
