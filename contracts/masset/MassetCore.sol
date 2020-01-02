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
    IManager internal manager;
    address internal governance;
    ISystok internal systok;
    IForgeLib forgeLib;

    /** @dev FeePool */
    address internal feePool;

    /** @dev Meta information for ecosystem fees */
    uint256 public mintingFee;
    uint256 public redemptionFee;

    /** @dev Maximum minting/redemption fee */
    uint256 internal constant maxFee = 2e17;

    /** @dev Maximum allowance for flexibility in the basket adjusments (1 unit) */
    uint256 internal constant minGrace = 1e18;

    /** @dev Events to emit */
    event MintingFeeChanged(uint256 fee);
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
      * @dev Verifies that the caller is the Manager
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
      * @dev Set the address of the System Token here
      * @param _systok Address of the new Systok
      */
    function setSystok(ISystok _systok)
    external
    managerOrGovernance {
        require(address(_systok) != address(0), "Must be non null address");
        systok = _systok;
    }

    /**
      * @dev Upgrades the version of ForgeLib protocol
      * @param _newForgeLib Address of the new ForgeLib
      */
    function upgradeForgeLib(address _newForgeLib)
    external
    managerOrGovernance {
        require(_newForgeLib != address(0), "Must be non null address");
        forgeLib = IForgeLib(_newForgeLib);
    }

    /**
      * @dev Set the ecosystem fee for minting a masset
      * @param _mintingFee Fee calculated in (%/100 * 1e18)
      */
    function setMintingFee(uint256 _mintingFee)
    external
    onlyGovernance {
        require(_mintingFee <= maxFee, "Minting fee > maxFee");
        mintingFee = _mintingFee;
        emit MintingFeeChanged(_mintingFee);
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