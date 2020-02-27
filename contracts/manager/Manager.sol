pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import { IManager } from "../interfaces/IManager.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { IOracleHub } from "../interfaces/IOracleHub.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

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

    using SafeMath for uint256;

    /** @dev Events to emit */
    event MassetAdded(bytes32 indexed key, address addr);
    event BassetBrokenPeg(address indexed bAsset, bool underPeg);
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
      */
    function validateBasset(
        address /* _masset */,
        address /* _newBasset */,
        uint256 /* _measurementMultiple */,
        bool /* _isTransferFeeCharged */
    )
        external
        view
        returns (bool isValid)
    {
        return true;
    }

    /***************************************
                    ORACLE
    ****************************************/

    /**
      * @dev Fetch the price of a Masset from OracleHub
      * Reverts if price is not available
      * @param _asset1 Address of the first asset
      * @param _asset2 Address of the second asset
      * @return uint256 Price of Masset where $1 == 1e18
      * @return uint256 Price of Systok where $1 == 1e18
      */
    function getAssetPrices(address _asset1, address _asset2)
        external
        view
        returns(uint256 massetPrice, uint256 systokPrice)
    {
        // Fetch the prices where $1 == 1e6
        (bool[2] memory isFresh, uint64[2] memory prices) = IOracleHub(_oracleHub()).readPricePair([_asset1, _asset2]);

        // Validate state of the response
        require(prices.length == 2, "Must return valid pair");
        for(uint256 i = 0; i < prices.length; i++){
            require(isFresh[i] && prices[i] > 0, "Prices must exist and be fresh");
        }

        // Cast prices into relevant format
        return (prices[0] * 1e12, prices[1] * 1e12);
    }

    /**
      * @dev Fetch the price of a Masset from OracleHub
      * Reverts if price is not available
      * @param _asset Address of the Masset
      * @return uint256 Price of Masset where $1 == 1e18
      * @return uint256 Price of Systok where $1 == 1e18
      */
    function getAssetPrice(address _asset)
        external
        view
        returns(uint256 assetPrice)
    {
        // Fetch the price where $1 == 1e6
        (bool isFresh, uint256 price) = _getPriceFromOracle(_oracleHub(), _asset);

        // Validate state of the response
        require(isFresh, "Must return valid price");

        // Cast prices into relevant format
        return price * 1e12;
    }

    /**
      * @dev Detects Basset peg deviation for a particular Masset
      * @param _masset    Address of the Masset for which to check peg loss
      */
    function detectPegDeviation(address _masset)
        external
    {
        // get all bAsset keys
        (address[] memory addresses) = IMasset(_masset).getAllBassetsAddress();
        uint count = addresses.length;
        require(count > 0, "Incorrect basset details");

        address oracleAddress = _oracleHub();

        // foreach bAsset
        for (uint i = 0; i < count; i++) {
            // collect relative prices from the OracleHub
            (bool isFresh, uint price) = _getPriceFromOracle(oracleAddress, addresses[i]);

            // If price (exists && fresh)
            if (price > 0 && isFresh){
                // then getDelta(price <> peg)
                (bool isBelowPeg, uint delta) = _calcRelativePriceDelta(price);

                bool hasBrokenPeg = isBelowPeg
                    ? delta >= neg_deviation_threshold
                    : delta >= pos_deviation_threshold;

                // If delta >= threshold, then trigger recol
                if(hasBrokenPeg){
                    IMasset masset = IMasset(_masset);
                    masset.handlePegLoss(addresses[i], isBelowPeg);
                    emit BassetBrokenPeg(addresses[i], isBelowPeg);
                }
                // else skip
            }
        }
    }

    /**
      * @dev Fetch a price from OracleHub
      * @param _oracle Address of the oraclehub
      * @param _asset Identifier of the asset
      * @return bool isFresh price is fresh
      * @return uint256 Price of asset where $1 == 1e18
      */
    function _getPriceFromOracle(address _oracle, address _asset)
    internal
    view
    returns(bool, uint256) {
        // Get price as 1e6
        (bool isFresh, uint64 price) = IOracleHub(_oracle).readPrice(_asset);
        // Convert price from 1e6 to 1e18
        return (isFresh, price * 1e12);
    }

    /**
      * @dev Calculates the absolute difference between input and peg
      * @param _relativePrice   Relative price of bassed where 1:1 == 1e18
      * @return bool Input is below Peg (1e18)
      * @return uint256 difference (delta from _relativePrice to 1e18)
      */
    function _calcRelativePriceDelta(uint256 _relativePrice)
    private
    pure
    returns (bool, uint256) {
        return _relativePrice > base_price
            ? (false, _relativePrice.sub(base_price))
            : (true, base_price.sub(_relativePrice));
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
