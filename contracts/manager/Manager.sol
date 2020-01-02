pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { ManagerModule, ISystok, IGovernancePortal, IOracleHub, IMasset } from "./ManagerModule.sol";
import { ManagerPortal } from "./ManagerPortal.sol";
import { MassetFactory, IManager } from "./MassetFactory.sol";

import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
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
    ManagerModule,
    ManagerPortal,
    MassetFactory
{

    using StableMath for uint256;

    /** @dev Events to emit */
    event BassetBrokenPeg(bytes32 indexed key, bool underPeg);


    /**
      * @dev Sets up the core state of the Manager
      * @param _governance        Current system governance portal
      * @param _nexus             Nexus module
      * @param _systok            Systok module
      * @param _oracleHub         OracleHub module
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

    /***************************************
                  PEG DETECTION
    ****************************************/

    /**
     * @dev Detects peg loss for all Massets in the system, and takes appropriate action
     */
    function detectAllPegDeviations()
    external {
        uint count = massets.keys.length;
        for(uint i = 0; i < count; i++){
            detectPegDeviation(massets.keys[i]);
        }
    }

    /**
      * @dev Detects Basset peg deviation for a particular Masset
      * @param _masset    Address of the Masset for which to check peg loss
      */
    function detectPegDeviation(address _masset)
    public {
        // get all basset keys
        (address[] memory addresses, bytes32[] memory keys) = _getBassets(_masset);
        uint count = addresses.length;
        require(count > 0 && count == keys.length, "Incorrect basset details");

        // foreach basset
        for (uint i = 0; i < count; i++) {
            // collect relative prices from the OracleHub
            (bool isFresh, uint price) = _getPriceFromOracle(keys[i]);

            // If price (exists && fresh)
            if (price > 0 && isFresh){
                // then getDelta(price <> peg)
                (bool isBelowPeg, uint delta) = _calcRelativePriceDelta(price);

                bool hasBrokenPeg = isBelowPeg
                    ? delta >= neg_deviation_threshold
                    : delta >= pos_deviation_threshold;

                // If delta >= threshold, then trigger recol
                if(hasBrokenPeg){
                    _triggerDeviationProcess(_masset, addresses[i], keys[i], isBelowPeg);
                }
                // else skip
            }
        }
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

    /**
      * @dev Internal triggering of Deviation process. If a Basset falls under peg then
      * it must be isolated from the system and the governance will decide what to do with it
      * @param _masset        Address of Masset
      * @param _basset        Basset that has lost its peg
      * @param _bassetKey     Key identifier for the Basset
      * @param _isBelowPeg    Boolean to signal that the asset has gone under, rather than over peg deviation threshold
      */
    function _triggerDeviationProcess(
        address _masset,
        address _basset,
        bytes32 _bassetKey,
        bool _isBelowPeg
    )
        internal
    {
        // Inform Masset to exclude Basset w/pos/neg
        IMasset masset = IMasset(_masset);
        bool alreadyActioned = masset.handlePegLoss(_basset, _isBelowPeg);

        // Generate proposal to GovernancePortal with affected BassetKey/addr

        // ***********
        //    TODO -> Consider the restrictions around creating proposal.. is this air tight?
        //    We don't want to create a proposal if already liquidating/liquidated (alreadyActioned),
        //    Or if vote underway.
        // ***********

        if(!alreadyActioned){
            governance.initiateFailedBassetVote(_masset, _basset);
            emit BassetBrokenPeg(_bassetKey, _isBelowPeg);
        }
    }


    /***************************************
              PROPOSAL RESOLUTION
    ****************************************/

    /**
     * @dev Called from the GovernancePortal after a resolved proposal
     * Re-introduces the isolated Basset back into the Basket
     * @param _masset   Address of the Masset
     * @param _basset   Address of the Basset
     *
     * TODO: Validate that the proposal has finished & result is negate?
     * Otherwise, this can be called via the multisig
     *
     */
    function negateRecol(
        address _masset,
        address _basset
    )
        external
        onlyGovernance
    {
        // Inform Masset to exclude Basset w/pos/neg
        IMasset masset = IMasset(_masset);
        masset.negatePegLoss(_basset);
    }

    /**
     * @dev Called from the GovernancePortal after a resolved proposal
     * Initialises the recollateralisation of the Basset in both Masset and Recol
     * @param _masset               Address of the Masset
     * @param _basset               Address of the Basset
     * @param _validatedMassetPrice Latest validated price of Masset from the governors (e18)
     * @param _validatedMetaPrice   Latest validated price of Meta from the governors (e18)
     */
    function recollatoraliseBasset(
        address _masset,
        address _basset,
        uint256 _validatedMassetPrice,
        uint256 _validatedMetaPrice
    )
        public
        onlyGovernance
    {
        (, , uint256 ratio, , uint256 balance, ) = IMasset(_masset).getBasset(_basset);

        // Ensure Masset knows about the recollateralisation
        IMasset(_masset).initiateRecol(_basset, address(recollateraliser));

        // Initiate the auction
        recollateraliser.recollateraliseBasset(_masset, _basset, balance, ratio, _validatedMassetPrice, _validatedMetaPrice);
    }

    /***************************************
              AUCTION RESOLUTION
    ****************************************/

    /**
     * @dev Forwards the completion of the recollateralisation process on towards the Masset
     */
    function completeRecol(
        address _masset,
        address _basset,
        uint256 _unitsUnderCollateralised
    )
        external
        onlyAuction
    {
        IMasset(_masset).completeRecol(_basset, _unitsUnderCollateralised);
    }
}
