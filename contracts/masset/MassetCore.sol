pragma solidity ^0.5.16;

import { IManager } from "../interfaces/IManager.sol";
import { IForgeValidator } from "./forge-validator/IForgeValidator.sol";

import { StableMath } from "../shared/StableMath.sol";
import { Module } from "../shared/Module.sol";

/**
 * @title MassetCore
 * @dev Core fields and accessors for Masset to conduct Admin
 */
contract MassetCore is Module {

    using StableMath for uint256;

    /** @dev Modules */
    IForgeValidator public forgeValidator;
    bool internal forgeValidatorLocked = false;

    /** @dev FeePool */
    address public feePool;

    /** @dev Meta information for ecosystem fees */
    uint256 public redemptionFee;

    /** @dev Maximum minting/redemption fee */
    uint256 internal constant maxFee = 2e17;

    /** @dev Events to emit */
    event RedemptionFeeChanged(uint256 fee);
    event FeeRecipientChanged(address feePool);

    constructor(address _nexus) Module(_nexus) public {}

    /**
      * @dev Verifies that the caller either Manager or Gov
      */
    modifier managerOrGovernor() {
        require(_manager() == msg.sender || _governor() == msg.sender, "Must be manager or governance");
        _;
    }

    /**
      * @dev Upgrades the version of ForgeValidator protocol
      * @param _newForgeValidator Address of the new ForgeValidator
      */
    function upgradeForgeValidator(address _newForgeValidator)
    external
    managerOrGovernor {
        require(!forgeValidatorLocked, "Must be allowed to upgrade");
        require(_newForgeValidator != address(0), "Must be non null address");
        forgeValidator = IForgeValidator(_newForgeValidator);
    }

    /**
      * @dev Locks the ForgeValidator into it's final form
      */
    function lockForgeValidator()
    external
    managerOrGovernor {
        forgeValidatorLocked = true;
    }

    /**
      * @dev Set the recipient address of forge fees
      * @param _feePool Address of the fee pool
      */
    function setFeePool(address _feePool)
    external
    managerOrGovernor {
        require(_feePool != address(0), "Must be valid address");
        feePool = _feePool;
        emit FeeRecipientChanged(_feePool);
    }


    /**
      * @dev Set the ecosystem fee for redeeming a masset
      * @param _redemptionFee Fee calculated in (%/100 * 1e18)
      */
    function setRedemptionFee(uint256 _redemptionFee)
    external
    managerOrGovernor {
        require(_redemptionFee <= maxFee, "Redemption fee > maxFee");
        redemptionFee = _redemptionFee;
        emit RedemptionFeeChanged(_redemptionFee);
    }
}
