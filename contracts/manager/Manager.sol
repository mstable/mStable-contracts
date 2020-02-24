pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import { IManager } from "../interfaces/IManager.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { IOracleHub } from "../interfaces/IOracleHub.sol";

import { ManagerState } from "./ManagerState.sol";

import { StableMath } from "../shared/math/StableMath.sol";

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
    ManagerState
{
    using StableMath for uint256;

    /** @dev Events to emit */
    event MassetAdded(bytes32 indexed key, address addr);
    event MassetEjected(bytes32 indexed key, address addr);

    /**
      * @dev Sets up the core state of the Manager
      * @param _nexus             Nexus module
      * @param _forgeValidator          Address of current ForgeValidator
      */
    constructor(
        address _nexus,
        address _forgeValidator
    )
        ManagerState(_nexus)
        public
    {
        forgeValidator = _forgeValidator;
    }


    /***************************************
              BASKET MANAGEMENT
    ****************************************/

    /**
      * @dev Upgrades the version of ForgeValidator referenced across the Massets
      * @param _newForgeValidator Address of the new ForgeValidator
      */
    function upgradeForgeValidator(address _newForgeValidator)
        external
        onlyGovernor
    {
        address[] memory _massets = massets.keys;
        for(uint256 i = 0; i < _massets.length; i++) {
            IMasset tempMasset = IMasset(_massets[i]);
            tempMasset.upgradeForgeValidator(_newForgeValidator);
        }
    }

    /***************************************
                      ETC
    ****************************************/

    /**
      * @dev Fetch the price of a Masset from OracleHub
      * Reverts if price is not available
      * @param _addr Address of the Masset
      * @return uint256 Price of Masset where $1 == 1e18
      * @return uint256 Price of Systok where $1 == 1e18
      */
    function getMassetPrice(address _addr)
        external
        view
        returns(uint256 massetPrice, uint256 systokPrice)
    {
        // Get the relevant masset key
        bytes32 key = massets.get(_addr);

        // Fetch the prices where $1 == 1e6
        (bool[2] memory isFresh, uint64[2] memory prices) = IOracleHub(_oracleHub()).readPricePair([key, oracle_key_systok]);

        // Validate state of the response
        require(prices.length == 2, "Must return valid pair");
        for(uint i = 0; i < prices.length; i++){
          require(isFresh[i] && prices[i] > 0, "Prices must exist and be fresh");
        }

        // Cast prices into relevant format
        return (prices[0] * 1e12, prices[1] * 1e12);
    }


    /***************************************
                  FACTORY
    ****************************************/

    /**
      * @dev Adds an already and initialised Masset to the stack, storing the relevant data in the ManagerState
      * @param _massetKey     Key identifier for the Masset
      * @param _masset        Address of the Masset contract
      * @return               Address of new Masset
      */
    function addMasset(
        bytes32 _massetKey,
        address _masset
    )
        external
        onlyGovernor
        returns (address)
    {
        require(_masset != address(0), "Masset must be a referenced implementation");

        massets.add(_masset, _massetKey);

        emit MassetAdded(_massetKey, _masset);
        return _masset;
    }

    /**
      * @dev Removes a Masset from the system and thus releases from recollateraliastion protection
      * @param _masset        Address of the Masset contract
      */
    function ejectMasset(
        address _masset
    )
        external
        onlyGovernor
    {
        require(_masset != address(0), "Masset must be a referenced implementation");
        bytes32 key = massets.get(_masset);
        require(key != bytes32(0x0), "Masset must be a referenced implementation");

        massets.remove(_masset);

        emit MassetEjected(key, _masset);
    }
}
