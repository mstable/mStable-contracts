pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { IManager } from "../interfaces/IManager.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { IOracleHub } from "../interfaces/IOracleHub.sol";

import { ManagerState } from "./ManagerState.sol";

/**
 * @title Manager
 * @dev Base class for managing mStable Assets (Massets)
 * Manager:
 * - Manages the basket
 * - Coordinates recollateralisation
 * - Maintains State
 * Portal: Provides Massets with prices and general interface into system
 * FactoryHub: Creates more Massets
 */
contract Manager is
    IManager,
    ManagerState
{
    /** @dev Events to emit */
    event MassetAdded(bytes32 indexed key, address addr);
    event MassetEjected(bytes32 indexed key, address addr);

    /**
      * @dev Sets up the core state of the Manager
      * @param _nexus             Nexus module
      */
    constructor(
        address _nexus
    )
        ManagerState(_nexus)
        public
    {
    }


    /***************************************
              BASKET MANAGEMENT
    ****************************************/

    /**
      * @dev Validates the addition of a new bAsset to a given mAsset
      * @param _masset                 Address of the new Masset to which the bAsset is added
      * @param _newBasset              Address of the new bAsset
      * @param _measurementMultiple    MM relative to the mAsset
      * @param _isTransferFeeCharged   Does this bAsset have transfer fee
      */
    function validateBasset(
        address _masset,
        address _newBasset,
        uint256 _measurementMultiple,
        bool _isTransferFeeCharged
    )
        external
        view
        returns (bool isValid)
    {
        return true;
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
        for(uint256 i = 0; i < prices.length; i++){
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
        require(_masset != address(0), "Masset addr is address(0)");

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
        require(_masset != address(0), "Masset addr is address(0)");
        bytes32 key = massets.get(_masset);
        require(key != bytes32(0x0), "Masset key is bytes(0x0)");
        require(IERC20(_masset).totalSupply() == 0, "Masset must be unused");

        massets.remove(_masset);

        emit MassetEjected(key, _masset);
    }
}
