pragma solidity 0.5.16;

// External
import { IMasset } from "../interfaces/IMasset.sol";
import { ISavingsContract } from "../interfaces/ISavingsContract.sol";
import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";

// Internal
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";
import { PausableModule } from "../shared/PausableModule.sol";

//Libs
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

    event SavingsContractEnabled(address indexed mAsset, address savingsContract);
    event SavingsRateChanged(uint256 newSavingsRate);
    event InterestCollected(address indexed mAsset, uint256 interest, uint256 newTotalSupply, uint256 apy);
    event InterestDistributed(address indexed mAsset, uint256 amountSent);
    event InterestWithdrawnByGovernor(address indexed mAsset, address recipient, uint256 amount);

    // Locations of each mAsset savings contract
    mapping(address => ISavingsContract) public savingsContracts;
    // Time at which last collection was made
    mapping(address => uint256) public lastCollection;

    // Amount of collected interest that will be send to Savings Contract
    uint256 private savingsRate = 1e18;
    // Utils to help keep interest under check
    uint256 constant private secondsInYear = 365 days;
    // Put a theoretical cap on max APY at 50%
    uint256 constant private maxAPY = 50e16;

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

        IERC20(_mAsset).safeApprove(address(_savingsContract), 0);
        IERC20(_mAsset).safeApprove(address(_savingsContract), uint256(-1));

        emit SavingsContractEnabled(_mAsset, _savingsContract);
    }

    function setSavingsRate(uint256 _savingsRate)
        external
        onlyGovernor
    {
        require(_savingsRate > 50e16 && _savingsRate <= 1e18, "Must be a valid rate");
        savingsRate = _savingsRate;
        emit SavingsRateChanged(_savingsRate);
    }

    /***************************************
                COLLECTION
    ****************************************/

    function collectAndDistributeInterest(address _mAsset)
        external
        whenNotPaused
    {
        uint256 previousCollection = lastCollection[_mAsset];

        // Only collect interest if it has been 30 mins
        uint256 timeSinceLastCollection = now.sub(previousCollection);
        if(timeSinceLastCollection > 30 minutes){

            lastCollection[_mAsset] = now;

            IMasset mAsset = IMasset(_mAsset);
            (uint256 interestCollected, uint256 totalSupply) = mAsset.collectInterest();

            if(interestCollected > 0){

                // 1. Validate that the interest has been collected and is within certain limits
                require(IERC20(_mAsset).balanceOf(address(this)) >= interestCollected, "Must recceive mUSD");

                // Seconds since last collection
                uint256 secondsSinceLastCollection = now.sub(previousCollection);
                // e.g. day: (86400 * 1e18) / 3.154e7 = 2.74..e15
                uint256 yearsSinceLastCollection = secondsSinceLastCollection.divPrecisely(secondsInYear);
                // Percentage increase in total supply
                // e.g. (1e20 * 1e18) / 1e24 = 1e14 (or a 0.01% increase)
                uint256 percentageIncrease = interestCollected.divPrecisely(totalSupply);
                // e.g. 0.01% (1e14 * 1e18) / 2.74..e15 = 3.65e16 or 3.65% apr
                uint256 extrapolatedAPY = percentageIncrease.divPrecisely(yearsSinceLastCollection);

                require(extrapolatedAPY < maxAPY, "Interest protected from inflating past maxAPY");

                emit InterestCollected(_mAsset, interestCollected, totalSupply, extrapolatedAPY);

                // 2. Distribute the interest
                // Calculate the share for savers (95e16 or 95%)
                uint256 saversShare = interestCollected.mulTruncate(savingsRate);

                // Call depositInterest on contract
                ISavingsContract target = savingsContracts[_mAsset];
                target.depositInterest(saversShare);

                emit InterestDistributed(_mAsset, saversShare);
            } else {
                emit InterestCollected(_mAsset, 0, totalSupply, 0);
            }
        }
    }

    /***************************************
                MANAGEMENT
    ****************************************/

    function withdrawUnallocatedInterest(address _mAsset, address _recipient)
        external
        onlyGovernor
    {
        IERC20 mAsset = IERC20(_mAsset);
        uint256 balance = mAsset.balanceOf(address(this));
        mAsset.transfer(_recipient, balance);

        emit InterestWithdrawnByGovernor(_mAsset, _recipient, balance);
    }
}
