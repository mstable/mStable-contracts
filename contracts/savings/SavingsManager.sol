pragma solidity 0.5.16;

import { IMasset } from "../interfaces/IMasset.sol";
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";
import { ISavingsContract } from "../interfaces/ISavingsContract.sol";

import { PausableModule } from "../shared/PausableModule.sol";

import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }  from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";

/**
 * @title SavingsManager
 */
contract SavingsManager is ISavingsManager, PausableModule {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    // Locations of each mAsset savings contract
    mapping(address => ISavingsContract) public savingsContracts;
    // Unallocated storage of interest collected
    mapping(address => uint256) public mAssetVault;

    // Amount of collected interest that will be send to Savings Contract
    uint256 constant private savingsRate = 95e16;
    // Time at which last collection was made
    uint256 private lastCollection;
    uint256 constant private secondsInYear = 365 days;
    uint256 constant private maxAPR = 50e16;

    constructor(
        address _nexus,
        address _mUSD,
        ISavingsContract _savingsContract
    )
        PausableModule(_nexus)
        public
    {
        savingsContracts[_mUSD] = _savingsContract;
        IERC20(_mUSD).approve(address(_savingsContract), uint256(-1));
    }

    /***************************************
                    STATE
    ****************************************/

    function setSavingsContract(address _mAsset, address _savingsContract)
        external
        onlyGovernor
    {
        require(_mAsset != address(0) && _savingsContract != address(0), "Must be valid address");
        savingsContracts[_mAsset] = ISavingsContract(_savingsContract);
        IERC20(_mAsset).approve(address(_savingsContract), uint256(-1));
    }

    /***************************************
                COLLECTION
    ****************************************/

    function collectAndDistributeInterest(address _mAsset)
        external
        whenNotPaused
    {
        _collectInterest(_mAsset);
        _distributeInterest(_mAsset);
    }

    function collectInterest(address _mAsset)
        external
        whenNotPaused
    {
        _collectInterest(_mAsset);
    }

    function _collectInterest(address _mAsset)
        internal
    {
        IMasset mAsset = IMasset(_mAsset);
        (uint256 interestCollected, uint256 totalSupply) = mAsset.collectInterest();

        uint256 previousCollection = lastCollection;
        lastCollection = now;
        // Seconds since last collection
        uint256 secondsSinceLastCollection = now.sub(previousCollection);
        // e.g. day: (86400 * 1e18) / 3.154e7 = 2.74..e15
        uint256 yearsSinceLastCollection = secondsSinceLastCollection.divPrecisely(secondsInYear);
        // Percentage increase in total supply
        // e.g. (1e20 * 1e18) / 1e24 = 1e14 (or a 0.01% increase)
        uint256 percentageIncrease = interestCollected.divPrecisely(totalSupply);
        // e.g. 0.01% (1e14 * 1e18) / 2.74..e15 = 3.65e16 or 3.65% apr
        uint256 extrapolatedAPR = percentageIncrease.divPrecisely(yearsSinceLastCollection);

        require(extrapolatedAPR < maxAPR, "Interest protected from inflating past maxAPR");

        // Add to the vault for distribution
        mAssetVault[_mAsset] = mAssetVault[_mAsset].add(interestCollected);
    }

    function distributeInterest(address _mAsset)
        external
        whenNotPaused
    {
        _distributeInterest(_mAsset);
    }

    function _distributeInterest(address _mAsset)
        internal
    {
        // Get the amount of mAsset in the vault
        uint256 mAssetToDistribute = mAssetVault[_mAsset];
        if(mAssetToDistribute > 0){
            mAssetVault[_mAsset] = 0;

            // Calc amount to send, remainder is kept here for Governor
            uint256 send = mAssetToDistribute.mulTruncate(savingsRate);

            // Call depositInterest on contract
            ISavingsContract target = savingsContracts[_mAsset];
            target.depositInterest(send);
        }
    }

    /***************************************
                MANAGEMENT
    ****************************************/

    function collectUnallocatedInterest(address _mAsset, address _recipient)
        external
        onlyGovernor
    {
        _distributeInterest(_mAsset);
        IERC20 mAsset = IERC20(_mAsset);
        uint256 balance = mAsset.balanceOf(address(this));
        mAsset.transfer(_recipient, balance);
    }
}
