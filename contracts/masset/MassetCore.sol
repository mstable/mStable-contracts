pragma solidity ^0.5.12;

import { IManager } from "../interfaces/IManager.sol";
import { ISystok } from "../interfaces/ISystok.sol";
import { IForgeLib } from "./libs/IForgeLib.sol";

import { StableMath } from "../shared/math/StableMath.sol";

/**
 * @title MassetCore
 * @dev Core fields and accessors for Masset to conduct Admin
 */
contract MassetCore {

    using StableMath for uint256;

    /** @dev Modules */
    IManager public manager;
    address public governance;
    ISystok public systok;
    IForgeLib public forgeLib;
    bool internal forgeLibLocked = false;

    /** @dev FeePool */
    address public feePool;

    /** @dev Meta information for ecosystem fees */
    uint256 public redemptionFee;

    /** @dev Maximum minting/redemption fee */
    uint256 internal constant maxFee = 2e17;

    /** @dev Events to emit */
    event RedemptionFeeChanged(uint256 fee);

    /**
      * @dev Verifies that the caller is the Manager
      */
    modifier onlyManager() {
        require(address(manager) == msg.sender, "Must be manager");
        _;
    }

    /**
      * @dev Verifies that the caller is the Manager
      */
    modifier onlyGovernance() {
        require(governance == msg.sender, "Must be governance");
        _;
    }

    /**
      * @dev Verifies that the caller either Manager or Gov
      */
    modifier managerOrGovernance() {
        require(address(manager) == msg.sender || governance == msg.sender, "Must be manager or governance");
        _;
    }

    /**
      * @dev Set the address of the new Manager here
      * @param _manager Address of the new Manager
      */
    function setManager(IManager _manager)
    external
    managerOrGovernance {
        manager = _manager;
    }

    /**
      * @dev Set the address of the new Governance Module here
      * @param _governance Address of the new Governance Module
      */
    function setGovernance(address _governance)
    external
    managerOrGovernance {
        governance = _governance;
    }

    /**
      * @dev Upgrades the version of ForgeLib protocol
      * @param _newForgeLib Address of the new ForgeLib
      */
    function upgradeForgeLib(address _newForgeLib)
    external
    managerOrGovernance {
        require(!forgeLibLocked, "Must be allowed to upgrade");
        require(_newForgeLib != address(0), "Must be non null address");
        forgeLib = IForgeLib(_newForgeLib);
    }

    /**
      * @dev Locks the ForgeLib into it's final form
      */
    function lockForgeLib()
    external
    managerOrGovernance {
        forgeLibLocked = true;
    }

    /**
      * @dev Set the recipient address of forge fees
      * @param _feePool Address of the fee pool
      */
    function setFeePool(address _feePool)
    external
    onlyGovernance {
        require(_feePool != address(0), "Must be valid address");
        feePool = _feePool;
    }


    /**
      * @dev Set the ecosystem fee for redeeming a masset
      * @param _redemptionFee Fee calculated in (%/100 * 1e18)
      */
    function setRedemptionFee(uint256 _redemptionFee)
    external
    onlyGovernance {
        require(_redemptionFee <= maxFee, "Redemption fee > maxFee");
        redemptionFee = _redemptionFee;
        emit RedemptionFeeChanged(_redemptionFee);
    }

}