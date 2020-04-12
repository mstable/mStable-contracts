pragma solidity 0.5.16;

// External
import { IMasset } from "../interfaces/IMasset.sol";
import { ISavingsContract } from "../interfaces/ISavingsContract.sol";

// Internal
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";
import { PausableModule } from "../shared/PausableModule.sol";

//Libs
import { IERC20 }     from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 }  from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";

/**
 * @title   SavingsManager
 * @author  Stability Labs Pty. Lte.
 * @notice  Savings Manager collects interest from mAssets and sends them to the
 *          corresponding Savings Contract, performing some validation in the process.
 * @dev     VERSION: 1.0
 *          DATE:    2020-03-28
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
    event WaitFor(uint256 timeRemaining);

    // Locations of each mAsset savings contract
    mapping(address => ISavingsContract) public savingsContracts;
    // Time at which last collection was made
    mapping(address => uint256) public lastCollection;

    // Amount of collected interest that will be sent to Savings Contract (100%)
    uint256 private savingsRate = 1e18;
    // Utils to help keep interest under check
    uint256 constant private secondsInYear = 365 days;
    // Theoretical cap on APY at 50% to avoid excess inflation
    uint256 constant private MAX_APY = 5e17;
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
        require(address(savingsContracts[_mAsset]) == address(0), "Savings contract exist");
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
        require(address(savingsContracts[_mAsset]) != address(0), "Savings contract not exist");
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

        uint256 previousCollection = lastCollection[_mAsset];

        // 1. Only collect interest if it has been 30 mins
        uint256 timeSinceLastCollection = now.sub(previousCollection);
        if(timeSinceLastCollection > THIRTY_MINUTES) {

            lastCollection[_mAsset] = now;

            // 2. Collect the new interest from the mAsset
            IMasset mAsset = IMasset(_mAsset);
            (uint256 interestCollected, uint256 totalSupply) = mAsset.collectInterest();

            if(interestCollected > 0) {

                // 3. Validate that the interest has been collected and is within certain limits
                require(
                    IERC20(_mAsset).balanceOf(address(this)) >= interestCollected,
                    "Must receive mUSD"
                );

                // Seconds since last collection
                uint256 secondsSinceLastCollection = now.sub(previousCollection);
                // e.g. day: (86400 * 1e18) / 3.154e7 = 2.74..e15
                uint256 yearsSinceLastCollection =
                    secondsSinceLastCollection.divPrecisely(secondsInYear);
                // Percentage increase in total supply
                // e.g. (1e20 * 1e18) / 1e24 = 1e14 (or a 0.01% increase)
                uint256 percentageIncrease = interestCollected.divPrecisely(totalSupply);
                // e.g. 0.01% (1e14 * 1e18) / 2.74..e15 = 3.65e16 or 3.65% apr
                uint256 extrapolatedAPY = percentageIncrease.divPrecisely(yearsSinceLastCollection);

                require(extrapolatedAPY < MAX_APY, "Interest protected from inflating past maxAPY");

                emit InterestCollected(_mAsset, interestCollected, totalSupply, extrapolatedAPY);

                // 4. Distribute the interest
                // Calculate the share for savers (95e16 or 95%)
                uint256 saversShare = interestCollected.mulTruncate(savingsRate);

                // Call depositInterest on contract
                savingsContract.depositInterest(saversShare);

                emit InterestDistributed(_mAsset, saversShare);
            } else {
                emit InterestCollected(_mAsset, 0, totalSupply, 0);
            }
        } else {
            emit WaitFor(THIRTY_MINUTES.sub(timeSinceLastCollection));
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
        onlyGovernor
    {
        IERC20 mAsset = IERC20(_mAsset);
        uint256 balance = mAsset.balanceOf(address(this));

        emit InterestWithdrawnByGovernor(_mAsset, _recipient, balance);

        mAsset.safeTransfer(_recipient, balance);
    }
}
