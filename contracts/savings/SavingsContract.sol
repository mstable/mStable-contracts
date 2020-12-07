pragma solidity 0.5.16;

// External
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";

// Internal
import { ISavingsContractV1, ISavingsContractV2 } from "../interfaces/ISavingsContract.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { InitializableModule } from "../shared/InitializableModule.sol";
import { IConnector } from "./peripheral/IConnector.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";


/**
 * @title   SavingsContract
 * @author  Stability Labs Pty. Ltd.
 * @notice  Savings contract uses the ever increasing "exchangeRate" to increase
 *          the value of the Savers "credits" relative to the amount of additional
 *          underlying collateral that has been deposited into this contract ("interest")
 * @dev     VERSION: 2.0
 *          DATE:    2020-11-28
 */
contract SavingsContract is
    ISavingsContractV1,
    ISavingsContractV2,
    Initializable,
    InitializableToken,
    InitializableModule
{

    using SafeMath for uint256;
    using StableMath for uint256;

    // Core events for depositing and withdrawing
    event ExchangeRateUpdated(uint256 newExchangeRate, uint256 interestCollected);
    event SavingsDeposited(address indexed saver, uint256 savingsDeposited, uint256 creditsIssued);
    event CreditsRedeemed(address indexed redeemer, uint256 creditsRedeemed, uint256 savingsCredited);
    event AutomaticInterestCollectionSwitched(bool automationEnabled);
    event PokerUpdated(address poker);
    event FractionUpdated(uint256 fraction);
    event Poked(uint256 oldBalance, uint256 newBalance, uint256 interestDetected);

    // Rate between 'savings credits' and underlying
    // e.g. 1 credit (1e17) mulTruncate(exchangeRate) = underlying, starts at 10:1
    // exchangeRate increases over time
    uint256 public exchangeRate = 1e17;

    // Underlying asset is underlying
    IERC20 public underlying;
    bool private automateInterestCollection = true;

    // Yield
    address public poker;
    uint256 public lastPoke;
    uint256 public lastBalance;
    uint256 public fraction;
    IConnector public connector;
    uint256 constant private POKE_CADENCE = 4 hours;
    uint256 constant private MAX_APY = 2e18;
    uint256 constant private SECONDS_IN_YEAR = 365 days;

    // TODO - use constant addresses during deployment. Adds to bytecode
    function initialize(
        address _nexus, // constant
        address _poker,
        IERC20 _underlying, // constant
        string calldata _nameArg,
        string calldata _symbolArg
    )
        external
        initializer
    {
        InitializableToken._initialize(_nameArg, _symbolArg);
        InitializableModule._initialize(_nexus);

        require(address(_underlying) != address(0), "mAsset address is zero");
        underlying = _underlying;

        require(_poker != address(0), "Invalid poker address");
        poker = _poker;

        fraction = 2e17;
    }

    /** @dev Only the savings managaer (pulled from Nexus) can execute this */
    modifier onlySavingsManager() {
        require(msg.sender == _savingsManager(), "Only savings manager can execute");
        _;
    }


    /** @dev Enable or disable the automation of fee collection during deposit process */
    function automateInterestCollectionFlag(bool _enabled)
        external
        onlyGovernor
    {
        automateInterestCollection = _enabled;
        emit AutomaticInterestCollectionSwitched(_enabled);
    }

    /***************************************
                    INTEREST
    ****************************************/

    /**
     * @dev Deposit interest (add to savings) and update exchange rate of contract.
     *      Exchange rate is calculated as the ratio between new savings q and credits:
     *                    exchange rate = savings / credits
     *
     * @param _amount   Units of underlying to add to the savings vault
     */
    function depositInterest(uint256 _amount)
        external
        onlySavingsManager // TODO - remove this?
    {
        require(_amount > 0, "Must deposit something");

        // Transfer the interest from sender to here
        require(underlying.transferFrom(msg.sender, address(this), _amount), "Must receive tokens");

        // Calc new exchange rate, protect against initialisation case
        uint256 totalCredits = totalSupply();
        if(totalCredits > 0) {
            // new exchange rate is relationship between _totalCredits & totalSavings
            // _totalCredits * exchangeRate = totalSavings
            // exchangeRate = totalSavings/_totalCredits
            uint256 amountPerCredit = _amount.divPrecisely(totalCredits);
            uint256 newExchangeRate = exchangeRate.add(amountPerCredit);
            exchangeRate = newExchangeRate;

            emit ExchangeRateUpdated(newExchangeRate, _amount);
        }
    }


    /***************************************
                    SAVING
    ****************************************/

    /**
     * @dev Deposit the senders savings to the vault, and credit them internally with "credits".
     *      Credit amount is calculated as a ratio of deposit amount and exchange rate:
     *                    credits = underlying / exchangeRate
     *      If automation is enabled, we will first update the internal exchange rate by
     *      collecting any interest generated on the underlying.
     * @param _underlying      Units of underlying to deposit into savings vault
     * @return creditsIssued   Units of credits issued internally
     */
    function depositSavings(uint256 _underlying)
        external
        returns (uint256 creditsIssued)
    {
        return _deposit(_underlying, msg.sender);
    }

    function depositSavings(uint256 _underlying, address _beneficiary)
        external
        returns (uint256 creditsIssued)
    {
        return _deposit(_underlying, _beneficiary);
    }

    function _deposit(uint256 _underlying, address _beneficiary)
        internal
        returns (uint256 creditsIssued)
    {
        require(_underlying > 0, "Must deposit something");

        // Collect recent interest generated by basket and update exchange rate
        IERC20 mAsset = underlying;
        ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(mAsset));

        // Transfer tokens from sender to here
        require(mAsset.transferFrom(msg.sender, address(this), _underlying), "Must receive tokens");

        // Calc how many credits they receive based on currentRatio
        creditsIssued = _underlyingToCredits(_underlying);

        // add credits to balances
        _mint(_beneficiary, creditsIssued);

        emit SavingsDeposited(_beneficiary, _underlying, creditsIssued);
    }

    /**
     * @dev Redeem specific number of the senders "credits" in exchange for underlying.
     *      Payout amount is calculated as a ratio of credits and exchange rate:
     *                    payout = credits * exchangeRate
     * @param _credits         Amount of credits to redeem
     * @return massetReturned  Units of underlying mAsset paid out
     */
    function redeem(uint256 _credits)
        external
        returns (uint256 massetReturned)
    {
        require(_credits > 0, "Must withdraw something");

        massetReturned = _redeem(_credits);

        // Collect recent interest generated by basket and update exchange rate
        if(automateInterestCollection) {
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(underlying));
        }
    }

    function redeemCredits(uint256 _credits)
        external
        returns (uint256 massetReturned)
    {
        require(_credits > 0, "Must withdraw something");

        // Collect recent interest generated by basket and update exchange rate
        if(automateInterestCollection) {
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(underlying));
        }

        return _redeem(_credits);
    }

    function redeemUnderlying(uint256 _underlying)
        external
        returns (uint256 creditsBurned)
    {
        require(_underlying > 0, "Must withdraw something");

        if(automateInterestCollection) {
            // Collect recent interest generated by basket and update exchange rate
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(underlying));
        }

        uint256 requiredCredits = _underlyingToCredits(_underlying);

        uint256 returned = _redeem(requiredCredits);
        require(returned == _underlying, "Did not redeem sufficiently");

        return requiredCredits;
    }

    function _redeem(uint256 _credits)
        internal
        returns (uint256 massetReturned)
    {
        _burn(msg.sender, _credits);

        // Calc payout based on currentRatio
        (uint256 amt, uint256 exchangeRate_) = _creditsToUnderlying(_credits);

        // TODO - check the collateralisation here
        //      - if over fraction + 2e17, then withdraw down to fraction
        //      - ensure that it does not affect with the APY calculations in poke

        // Transfer tokens from here to sender
        require(underlying.transfer(msg.sender, massetReturned), "Must send tokens");

        emit CreditsRedeemed(msg.sender, _credits, massetReturned);

        return amt;
    }

    /***************************************
                    YIELD
    ****************************************/


    modifier onlyPoker() {
        require(msg.sender == poker, "Only poker can execute");
        _;
    }

    // Protects against initiailisation case
    function poke()
        external
        onlyPoker
    {
        // TODO
        // Consider security optimisation: lastExchangeRate vs lastBalance.. do global check rather than just checking the balance of connectors

        // 1. Verify that poke cadence is valid
        uint256 currentTime = uint256(now);
        uint256 timeSinceLastPoke = currentTime.sub(lastPoke);
        require(timeSinceLastPoke > POKE_CADENCE, "Not enough time elapsed");
        lastPoke = currentTime;

        // 2. Check and verify new connector balance
        uint256 connectorBalance = connector.checkBalance();
        uint256 lastBalance_ = lastBalance;
        if(connectorBalance > 0){
            require(connectorBalance >= lastBalance_, "Invalid yield");
            _validateCollection(connectorBalance, connectorBalance.sub(lastBalance_), timeSinceLastPoke);
        }
        lastBalance = connectorBalance;

        // 3. Level the assets to Fraction (connector) & 100-fraction (raw)
        uint256 balance = underlying.balanceOf(address(this));
        uint256 realSum = balance.add(connectorBalance);
        // e.g. 1e20 * 2e17 / 1e18 = 2e19
        uint256 idealConnectorAmount = realSum.mulTruncate(fraction);
        if(idealConnectorAmount > connectorBalance){
            // deposit to connector
            connector.deposit(idealConnectorAmount.sub(connectorBalance));
        } else {
            // withdraw from connector
            connector.withdraw(connectorBalance.sub(idealConnectorAmount));
        }

        // 4. Calculate new exchangeRate
        (uint256 totalCredited, uint256 exchangeRate_) = _creditsToUnderlying(totalSupply());
        if(realSum > totalCredited){
            exchangeRate = realSum.divPrecisely(totalSupply());
        }

        // emit Poked(lastBalance_, connectorBalance, );
    }

    function _validateCollection(uint256 _newBalance, uint256 _interest, uint256 _timeSinceLastCollection)
        internal
        pure
        returns (uint256 extrapolatedAPY)
    {
        // Percentage increase in total supply
        // e.g. (1e20 * 1e18) / 1e24 = 1e14 (or a 0.01% increase)
        // e.g. (5e18 * 1e18) / 1.2e24 = 4.1667e12
        // e.g. (1e19 * 1e18) / 1e21 = 1e16
        uint256 oldSupply = _newBalance.sub(_interest);
        uint256 percentageIncrease = _interest.divPrecisely(oldSupply);

        //      If over 30 mins, extrapolate APY
        // e.g. day: (86400 * 1e18) / 3.154e7 = 2.74..e15
        // e.g. 30 mins: (1800 * 1e18) / 3.154e7 = 5.7..e13
        // e.g. epoch: (1593596907 * 1e18) / 3.154e7 = 50.4..e18
        uint256 yearsSinceLastCollection =
            _timeSinceLastCollection.divPrecisely(SECONDS_IN_YEAR);

        // e.g. 0.01% (1e14 * 1e18) / 2.74..e15 = 3.65e16 or 3.65% apr
        // e.g. (4.1667e12 * 1e18) / 5.7..e13 = 7.1e16 or 7.1% apr
        // e.g. (1e16 * 1e18) / 50e18 = 2e14
        extrapolatedAPY = percentageIncrease.divPrecisely(yearsSinceLastCollection);

        require(extrapolatedAPY < MAX_APY, "Interest protected from inflating past maxAPY");
    }

    function setPoker(address _newPoker)
        external
        onlyGovernor
    {
        require(_newPoker != address(0) && _newPoker != poker, "Invalid poker");

        poker = _newPoker;

        emit PokerUpdated(_newPoker);
    }

    function setFraction(uint256 _fraction)
        external
        onlyGovernor
    {
        require(_fraction <= 5e17, "Fraction must be <= 50%");

        fraction = _fraction;

        emit FractionUpdated(_fraction);
    }

    function setConnector()
        external
        onlyGovernor
    {
        // Withdraw all from previous
        // deposit to new
        // check that the balance is legit
    }

    function emergencyStop(uint256 _withdrawAmount)
        external
        onlyGovernor
    {
        // withdraw _withdrawAmount from connection
        // check total collateralisation of credits
        // set collateralisation ratio
        // emit emergencyStop
    }
    

    /***************************************
                    VIEWING
    ****************************************/

    function balanceOfUnderlying(address _user) external view returns (uint256 balance) {
        (balance,) = _creditsToUnderlying(balanceOf(_user));
    }

    function creditBalances(address _user) external view returns (uint256) {
        return balanceOf(_user);
    }

    function underlyingToCredits(uint256 _underlying) external view returns (uint256) {
        return _underlyingToCredits(_underlying);
    }

    function creditsToUnderlying(uint256 _credits) external view returns (uint256 amount) {
        (amount,) = _creditsToUnderlying(_credits);
    }

    /**
     * @dev Converts masset amount into credits based on exchange rate
     *               c = masset / exchangeRate
     */
    function _underlyingToCredits(uint256 _underlying)
        internal
        view
        returns (uint256 credits)
    {
        // e.g. (1e20 * 1e18) / 1e18 = 1e20
        // e.g. (1e20 * 1e18) / 14e17 = 7.1429e19
        // e.g. 1 * 1e18 / 1e17 + 1 = 11 => 11 * 1e17 / 1e18 = 1.1e18 / 1e18 = 1
        credits = _underlying.divPrecisely(exchangeRate).add(1);
    }

    /**
     * @dev Converts masset amount into credits based on exchange rate
     *               m = credits * exchangeRate
     */
    function _creditsToUnderlying(uint256 _credits)
        internal
        view
        returns (uint256 underlyingAmount, uint256 exchangeRate_)
    {
        // e.g. (1e20 * 1e18) / 1e18 = 1e20
        // e.g. (1e20 * 14e17) / 1e18 = 1.4e20
        exchangeRate_ = exchangeRate;
        underlyingAmount = _credits.mulTruncate(exchangeRate_);
    }
}
