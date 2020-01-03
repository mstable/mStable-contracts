pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { ManagerModule, ISystok, IGovernancePortal, IOracleHub, IMasset } from "./ManagerModule.sol";
import { ManagerPortal } from "./ManagerPortal.sol";
import { MassetFactory, IManager } from "./MassetFactory.sol";

import { StableMath } from "../shared/math/StableMath.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

/**
 * @title Manager
 * @dev Base class for managing mStable Assets (Massets)
 * Manager:
 * - Manages the basket
 * - Coordinates recollateralisation
 * - Maintains State
 * Module: Handles new module updates published by the Nexus
 * Portal: Provides Massets with prices and general interface into system
 * FactoryHub: Creates more Massets
 */
contract Manager is
    IManager,
    ManagerModule,
    ManagerPortal,
    MassetFactory
{

    using StableMath for uint256;

    /**
      * @dev Sets up the core state of the Manager
      * @param _governance        Current system governance portal
      * @param _nexus             Nexus module
      * @param _systok            Systok module
      * @param _oracleHub         OracleHub module
      * @param _forgeLib          Address of current ForgeLib
      */
    constructor(
        IGovernancePortal _governance,
        address _nexus,
        ISystok _systok,
        IOracleHub _oracleHub,
        address _forgeLib
    )
        ManagerModule(_nexus)
        public
    {
        governance = _governance;
        systok = _systok;
        oracleHub = _oracleHub;
        forgeLib = _forgeLib;
    }


    /***************************************
              BASKET MANAGEMENT
    ****************************************/

    /**
      * @dev Upgrades the version of ForgeLib referenced across the Massets
      * @param _newForgeLib Address of the new ForgeLib
      */
    function upgradeForgeLib(address _newForgeLib)
    external
    onlyGovernance {
        address[] memory _massets = massets.keys;
        for(uint256 i = 0; i < _massets.length; i++) {
            IMasset tempMasset = IMasset(_massets[i]);
            tempMasset.upgradeForgeLib(_newForgeLib);
        }
    }
}
