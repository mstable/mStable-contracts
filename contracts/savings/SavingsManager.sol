pragma solidity 0.5.16;

// External
import { IMasset } from "../interfaces/IMasset.sol";
import { ISavingsContract } from "../interfaces/ISavingsContract.sol";

// Internal
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";
import { PausableModule } from "../shared/PausableModule.sol";

// Libs
import { IERC20 }     from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }  from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";

/**
 * @title   SavingsManager
 * @author  Stability Labs Pty. Ltd.
 * @notice  Savings Manager collects interest from mAssets and sends them to the
 *          corresponding Savings Contract, performing some validation in the process.
 * @dev     VERSION: 1.1
 *          DATE:    2020-07-29
 */
contract SavingsManager is ISavingsManager, PausableModule {

    using SafeMath for uint256;
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    // Core admin events
    event SavingsContractAdded(address indexed mAsset, address savingsContract);
    event SavingsContractUpdated(address indexed mAsset, address savingsContract);
    event SavingsRateChanged(uint256 newSavingsRate);
    // Interest collection
    event InterestCollected(address indexed mAsset, uint256 interest, uint256 newTotalSupply, uint256 apy);
    event InterestDistributed(address indexed mAsset, uint256 amountSent);
    event InterestWithdrawnByGovernor(address indexed mAsset, address recipient, uint256 amount);

    // Locations of each mAsset savings contract
    mapping(address => ISavingsContract) public savingsContracts;
    // Time at which last collection was made
    mapping(address => uint256) public lastPeriodStart;
    mapping(address => uint256) public lastCollection;
    mapping(address => uint256) public periodYield;

    // Amount of collected interest that will be sent to Savings Contract (100%)
    uint256 private savingsRate = 1e18;
    // Utils to help keep interest under check
    uint256 constant private SECONDS_IN_YEAR = 365 days;
    // Theoretical cap on APY to avoid excess inflation
    uint256 constant private MAX_APY = 15e18;
    uint256 constant private TEN_BPS = 1e15;
    uint256 constant private THIRTY_MINUTES = 30 minutes;

    constructor(
        address _nexus,
        address _mUSD,
        address _savingsContract
    )
        public
        PausableModule(_nexus)
    {
        _updateSavingsContract(_mUSD, _savingsContract);
        emit SavingsContractAdded(_mUSD, _savingsContract);
    }

    /***************************************
                    STATE
    ****************************************/

    /**
     * @dev Adds a new savings contract
     * @param _mAsset           Address of underlying mAsset
     * @param _savingsContract  Address of the savings contract
     */
    function addSavingsContract(address _mAsset, address _savingsContract)
        external
        onlyGovernor
    {
        require(address(savingsContracts[_mAsset]) == address(0), "Savings contract already exists");
        _updateSavingsContract(_mAsset, _savingsContract);
        emit SavingsContractAdded(_mAsset, _savingsContract);
    }

    /**
     * @dev Updates an existing savings contract
     * @param _mAsset           Address of underlying mAsset
     * @param _savingsContract  Address of the savings contract
     */
    function updateSavingsContract(address _mAsset, address _savingsContract)
        external
        onlyGovernor
    {
        require(address(savingsContracts[_mAsset]) != address(0), "Savings contract does not exist");
        _updateSavingsContract(_mAsset, _savingsContract);
        emit SavingsContractUpdated(_mAsset, _savingsContract);
    }

    function _updateSavingsContract(address _mAsset, address _savingsContract)
        internal
    {
        require(_mAsset != address(0) && _savingsContract != address(0), "Must be valid address");
        savingsContracts[_mAsset] = ISavingsContract(_savingsContract);

        IERC20(_mAsset).safeApprove(address(_savingsContract), 0);
        IERC20(_mAsset).safeApprove(address(_savingsContract), uint256(-1));
    }

    /**
     * @dev Sets a new savings rate for interest distribution
     * @param _savingsRate   Rate of savings sent to SavingsContract (100% = 1e18)
     */
    function setSavingsRate(uint256 _savingsRate)
        external
        onlyGovernor
    {
        // Greater than 90% upto 100%
        require(_savingsRate > 9e17 && _savingsRate <= 1e18, "Must be a valid rate");
        savingsRate = _savingsRate;
        emit SavingsRateChanged(_savingsRate);
    }

    /***************************************
                COLLECTION
    ****************************************/

    /**
     * @dev Collects interest from a target mAsset and distributes to the SavingsContract.
     *      Applies constraints such that the max APY since the last fee collection cannot
     *      exceed the "MAX_APY" variable.
     * @param _mAsset       mAsset for which the interest should be collected
     */
    function collectAndDistributeInterest(address _mAsset)
        external
        whenNotPaused
    {
        ISavingsContract savingsContract = savingsContracts[_mAsset];
        require(address(savingsContract) != address(0), "Must have a valid savings contract");

        // Get collection details
        uint256 recentPeriodStart = lastPeriodStart[_mAsset];
        uint256 previousCollection = lastCollection[_mAsset];
        lastCollection[_mAsset] = now;

        // 1. Collect the new interest from the mAsset
        IMasset mAsset = IMasset(_mAsset);
        (uint256 interestCollected, uint256 totalSupply) = mAsset.collectInterest();

        // 2. Update all the time stamps
        //    Avoid division by 0 by adding a minimum elapsed time of 1 second
        uint256 timeSincePeriodStart = StableMath.max(1, now.sub(recentPeriodStart));
        uint256 timeSinceLastCollection = StableMath.max(1, now.sub(previousCollection));

        uint256 inflationOperand = interestCollected;
        //    If it has been 30 mins since last collection, reset period data
        if(timeSinceLastCollection > THIRTY_MINUTES) {
            lastPeriodStart[_mAsset] = now;
            periodYield[_mAsset] = 0;
        }
        //    Else if period has elapsed, start a new period from the lastCollection time
        else if(timeSincePeriodStart > THIRTY_MINUTES) {
            lastPeriodStart[_mAsset] = previousCollection;
            periodYield[_mAsset] = interestCollected;
        }
        //    Else add yield to period yield
        else {
            inflationOperand = periodYield[_mAsset].add(interestCollected);
            periodYield[_mAsset] = inflationOperand;
        }

        // 3. Validate that interest is collected correctly and does not exceed max APY
        if(interestCollected > 0) {
            require(
                IERC20(_mAsset).balanceOf(address(this)) >= interestCollected,
                "Must receive mUSD"
            );

            uint256 extrapolatedAPY = _validateCollection(totalSupply, inflationOperand, timeSinceLastCollection);

            emit InterestCollected(_mAsset, interestCollected, totalSupply, extrapolatedAPY);

            // 4. Distribute the interest
            //    Calculate the share for savers (95e16 or 95%)
            uint256 saversShare = interestCollected.mulTruncate(savingsRate);

            //    Call depositInterest on contract
            savingsContract.depositInterest(saversShare);

            emit InterestDistributed(_mAsset, saversShare);
        } else {
            emit InterestCollected(_mAsset, 0, totalSupply, 0);
        }
    }

    /**
     * @dev Validates that an interest collection does not exceed a maximum APY. If last collection
     * was under 30 mins ago, simply check it does not exceed 10bps
     * @param _newSupply               New total supply of the mAsset
     * @param _interest                Increase in total supply since last collection
     * @param _timeSinceLastCollection Seconds since last collection
     */
    function _validateCollection(uint256 _newSupply, uint256 _interest, uint256 _timeSinceLastCollection)
        internal
        pure
        returns (uint256 extrapolatedAPY)
    {
        // e.g. day: (86400 * 1e18) / 3.154e7 = 2.74..e15
        // e.g. 30 mins: (1800 * 1e18) / 3.154e7 = 5.7..e13
        // e.g. epoch: (1593596907 * 1e18) / 3.154e7 = 50.4..e18
        uint256 yearsSinceLastCollection =
            _timeSinceLastCollection.divPrecisely(SECONDS_IN_YEAR);

        // Percentage increase in total supply
        // e.g. (1e20 * 1e18) / 1e24 = 1e14 (or a 0.01% increase)
        // e.g. (5e18 * 1e18) / 1.2e24 = 4.1667e12
        // e.g. (1e19 * 1e18) / 1e21 = 1e16
        uint256 oldSupply = _newSupply.sub(_interest);
        uint256 percentageIncrease = _interest.divPrecisely(oldSupply);

        // e.g. 0.01% (1e14 * 1e18) / 2.74..e15 = 3.65e16 or 3.65% apr
        // e.g. (4.1667e12 * 1e18) / 5.7..e13 = 7.1e16 or 7.1% apr
        // e.g. (1e16 * 1e18) / 50e18 = 2e14
        extrapolatedAPY = percentageIncrease.divPrecisely(yearsSinceLastCollection);

        //      If over 30 mins, extrapolate APY
        if(_timeSinceLastCollection > THIRTY_MINUTES) {
            require(extrapolatedAPY < MAX_APY, "Interest protected from inflating past maxAPY");
        } else {
            require(percentageIncrease < TEN_BPS, "Interest protected from inflating past 10 Bps");
        }
    }

    /***************************************
                MANAGEMENT
    ****************************************/

    /**
     * @dev Withdraws any unallocated interest, i.e. that which has been saved for use
     *      elsewhere in the system, based on the savingsRate
     * @param _mAsset       mAsset to collect from
     * @param _recipient    Address of mAsset recipient
     */
    function withdrawUnallocatedInterest(address _mAsset, address _recipient)
        external
        onlyGovernance
    {
        IERC20 mAsset = IERC20(_mAsset);
        uint256 balance = mAsset.balanceOf(address(this));

        emit InterestWithdrawnByGovernor(_mAsset, _recipient, balance);

        mAsset.safeTransfer(_recipient, balance);
    }
}
