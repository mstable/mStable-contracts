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
    event ConnectorUpdated(address connector);
    event EmergencyUpdate();

    event Poked(uint256 oldBalance, uint256 newBalance, uint256 interestDetected);
    event PokedRaw();

    // Rate between 'savings credits' and underlying
    // e.g. 1 credit (1e17) mulTruncate(exchangeRate) = underlying, starts at 10:1
    // exchangeRate increases over time
    uint256 public exchangeRate;
    uint256 public colRatio;

    // Underlying asset is underlying
    IERC20 public underlying;
    bool private automateInterestCollection;

    // Yield
    address public poker;
    uint256 public lastPoke;
    uint256 public lastBalance;
    uint256 public fraction;
    IConnector public connector;
    uint256 constant private POKE_CADENCE = 4 hours;
    uint256 constant private MAX_APY = 2e18;
    uint256 constant private SECONDS_IN_YEAR = 365 days;

    // TODO - Add these constants to bytecode at deploytime
    function initialize(
        address _nexus, // constant
        address _poker,
        IERC20 _underlying, // constant
        string calldata _nameArg, // constant
        string calldata _symbolArg // constant
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
        automateInterestCollection = true;
        exchangeRate = 1e17;
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
            uint256 amountPerCredit = _calcExchangeRate(_amount, totalCredits);
            uint256 newExchangeRate = exchangeRate.add(amountPerCredit);
            exchangeRate = newExchangeRate;

            emit ExchangeRateUpdated(newExchangeRate, _amount);
        }
    }


    /***************************************
                    DEPOSIT
    ****************************************/

    /**
     * @dev Deposit the senders savings to the vault, and credit them internally with "credits".
     *      Credit amount is calculated as a ratio of deposit amount and exchange rate:
     *                    credits = underlying / exchangeRate
     *      We will first update the internal exchange rate by collecting any interest generated on the underlying.
     * @param _underlying      Units of underlying to deposit into savings vault
     * @return creditsIssued   Units of credits issued internally
     */
    function depositSavings(uint256 _underlying)
        external
        returns (uint256 creditsIssued)
    {
        return _deposit(_underlying, msg.sender, false);
    }

    function depositSavings(uint256 _underlying, address _beneficiary)
        external
        returns (uint256 creditsIssued)
    {
        return _deposit(_underlying, _beneficiary, false);
    }

    function preDeposit(uint256 _underlying, address _beneficiary)
        external
        returns (uint256 creditsIssued)
    {
        return _deposit(_underlying, _beneficiary, true);
    }

    function _deposit(uint256 _underlying, address _beneficiary, bool _skipCollection)
        internal
        returns (uint256 creditsIssued)
    {
        require(_underlying > 0, "Must deposit something");

        // Collect recent interest generated by basket and update exchange rate
        IERC20 mAsset = underlying;
        if(!_skipCollection){
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(mAsset));
        }

        // Transfer tokens from sender to here
        require(mAsset.transferFrom(msg.sender, address(this), _underlying), "Must receive tokens");

        // Calc how many credits they receive based on currentRatio
        (creditsIssued,) = _underlyingToCredits(_underlying);

        // add credits to balances
        _mint(_beneficiary, creditsIssued);

        emit SavingsDeposited(_beneficiary, _underlying, creditsIssued);
    }


    /***************************************
                    REDEEM
    ****************************************/


    // Deprecated in favour of redeemCredits
    function redeem(uint256 _credits)
        external
        returns (uint256 massetReturned)
    {
        require(_credits > 0, "Must withdraw something");

        (, uint256 payout) = _redeem(_credits, true);

        // Collect recent interest generated by basket and update exchange rate
        if(automateInterestCollection) {
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(underlying));
        }

        return payout;
    }

    /**
     * @dev Redeem specific number of the senders "credits" in exchange for underlying.
     *      Payout amount is calculated as a ratio of credits and exchange rate:
     *                    payout = credits * exchangeRate
     * @param _credits         Amount of credits to redeem
     * @return massetReturned  Units of underlying mAsset paid out
     */
    function redeemCredits(uint256 _credits)
        external
        returns (uint256 massetReturned)
    {
        require(_credits > 0, "Must withdraw something");

        // Collect recent interest generated by basket and update exchange rate
        if(automateInterestCollection) {
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(underlying));
        }

        (, uint256 payout) = _redeem(_credits, true);

        return payout;
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

        (uint256 credits, uint256 massetReturned) = _redeem(_underlying, false);
        require(massetReturned == _underlying, "Invalid output");

        return credits;
    }

    function _redeem(uint256 _amt, bool _isCreditAmt)
        internal
        returns (uint256 creditsBurned, uint256 massetReturned)
    {
        // Centralise credit <> underlying calcs and minimise SLOAD count
        uint256 credits_ = 0;
        uint256 underlying_ = 0;
        uint256 exchangeRate_ = 0;
        if(_isCreditAmt){
            credits_ = _amt;
            (underlying_, exchangeRate_) = _creditsToUnderlying(_amt);
        } else {
            underlying_ = _amt;
            (credits_, exchangeRate_) = _underlyingToCredits(_amt);
        }

        _burn(msg.sender, credits_);

        // Transfer tokens from here to sender
        require(underlying.transfer(msg.sender, underlying_), "Must send tokens");

        CachedData memory cachedData = _cacheData();
        ConnectorStatus memory status = _getConnectorStatus(cachedData, exchangeRate_);
        if(status.inConnector > status.limit){
            _poke(cachedData, false);
        }

        emit CreditsRedeemed(msg.sender, credits_, underlying_);

        return (credits_, underlying_);
    }

    struct ConnectorStatus {
        uint256 limit;
        uint256 inConnector;
    }

    function _getConnectorStatus(CachedData memory _data, uint256 _exchangeRate)
        internal
        pure
        returns (ConnectorStatus memory)
    {
        uint256 totalCollat = _data.totalCredits.mulTruncate(_exchangeRate);
        uint256 limit = totalCollat.mulTruncate(_data.fraction.add(2e17));
        uint256 inConnector = _data.rawBalance >= totalCollat ? 0 : totalCollat.sub(_data.rawBalance);

        return ConnectorStatus(limit, inConnector);
    }

    /***************************************
                    YIELD - E
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
        CachedData memory cachedData = _cacheData();
        _poke(cachedData, false);
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

        CachedData memory cachedData = _cacheData();
        _poke(cachedData, true);

        emit FractionUpdated(_fraction);
    }

    // TODO - consider delaying this
    // function setConnector(address _newConnector)
    //     external
    //     onlyGovernor
    // {
    //     // Withdraw all from previous by setting target = 0
    //     CachedData memory cachedData = _cacheData();
    //     cachedData.fraction = 0;
    //     _poke(cachedData, true);
    //     // Set new connector
    //     CachedData memory cachedDataNew = _cacheData();
    //     connector = IConnector(_newConnector);
    //     _poke(cachedDataNew, true);

    //     emit ConnectorUpdated(_newConnector);
    // }

    // Should it be the case that some or all of the liquidity is trapped in
    function emergencyStop(uint256 _withdrawAmount)
        external
        onlyGovernor
    {
        // withdraw _withdrawAmount from connection
        connector.withdraw(_withdrawAmount);
        // check total collateralisation of credits
        CachedData memory data = _cacheData();
        // set collateralisation ratio
        _refreshExchangeRate(data.rawBalance, data.totalCredits, true);

        emit EmergencyUpdate();
    }


    /***************************************
                    YIELD - I
    ****************************************/

    function _poke(CachedData memory _data, bool _ignoreCadence) internal {
        // 1. Verify that poke cadence is valid
        uint256 currentTime = uint256(now);
        uint256 timeSinceLastPoke = currentTime.sub(lastPoke);
        require(_ignoreCadence || timeSinceLastPoke > POKE_CADENCE, "Not enough time elapsed");
        lastPoke = currentTime;

        IConnector connector_ = connector;
        if(address(connector_) != address(0)){

            // 2. Check and verify new connector balance
            uint256 lastBalance_ = lastBalance;
            uint256 connectorBalance = connector_.checkBalance();
            require(connectorBalance >= lastBalance_, "Invalid yield");
            if(connectorBalance > 0){
                _validateCollection(connectorBalance, connectorBalance.sub(lastBalance_), timeSinceLastPoke);
            }

            // 3. Level the assets to Fraction (connector) & 100-fraction (raw)
            uint256 realSum = _data.rawBalance.add(connectorBalance);
            uint256 ideal = realSum.mulTruncate(_data.fraction);
            if(ideal > connectorBalance){
                connector.deposit(ideal.sub(connectorBalance));
            } else {
                connector.withdraw(connectorBalance.sub(ideal));
            }

            // 4i. Refresh exchange rate and emit event
            lastBalance = ideal;
            _refreshExchangeRate(realSum, _data.totalCredits, false);
            emit Poked(lastBalance_, ideal, connectorBalance.sub(lastBalance_));

        } else {

            // 4ii. Refresh exchange rate and emit event
            lastBalance = 0;
            _refreshExchangeRate(_data.rawBalance, _data.totalCredits, false);
            emit PokedRaw();

        }
    }

    function _refreshExchangeRate(uint256 _realSum, uint256 _totalCredits, bool _ignoreValidation) internal {
        (uint256 totalCredited, ) = _creditsToUnderlying(_totalCredits);

        require(_ignoreValidation || _realSum >= totalCredited, "Insufficient capital");
        uint256 newExchangeRate = _calcExchangeRate(_realSum, _totalCredits);
        exchangeRate = newExchangeRate;

        emit ExchangeRateUpdated(newExchangeRate, _realSum.sub(totalCredited));
    }

    function _validateCollection(uint256 _newBalance, uint256 _interest, uint256 _timeSinceLastCollection)
        internal
        pure
        returns (uint256 extrapolatedAPY)
    {
        uint256 oldSupply = _newBalance.sub(_interest);
        uint256 percentageIncrease = _interest.divPrecisely(oldSupply);

        uint256 yearsSinceLastCollection =
            _timeSinceLastCollection.divPrecisely(SECONDS_IN_YEAR);

        extrapolatedAPY = percentageIncrease.divPrecisely(yearsSinceLastCollection);

        require(extrapolatedAPY < MAX_APY, "Interest protected from inflating past maxAPY");
    }
    

    /***************************************
                    VIEW - E
    ****************************************/

    function balanceOfUnderlying(address _user) external view returns (uint256 balance) {
        (balance,) = _creditsToUnderlying(balanceOf(_user));
    }

    function creditBalances(address _user) external view returns (uint256) {
        return balanceOf(_user);
    }

    function underlyingToCredits(uint256 _underlying) external view returns (uint256 credits) {
        (credits,) = _underlyingToCredits(_underlying);
    }

    function creditsToUnderlying(uint256 _credits) external view returns (uint256 amount) {
        (amount,) = _creditsToUnderlying(_credits);
    }


    /***************************************
                    VIEW - I
    ****************************************/

    struct CachedData {
        uint256 fraction;
        uint256 rawBalance;
        uint256 totalCredits;
    }

    function _cacheData() internal view returns (CachedData memory) {
        uint256 balance = underlying.balanceOf(address(this));
        return CachedData(fraction, balance, totalSupply());
    }

    /**
     * @dev Converts masset amount into credits based on exchange rate
     *               c = masset / exchangeRate
     */
    function _underlyingToCredits(uint256 _underlying)
        internal
        view
        returns (uint256 credits, uint256 exchangeRate_)
    {
        // e.g. (1e20 * 1e18) / 1e18 = 1e20
        // e.g. (1e20 * 1e18) / 14e17 = 7.1429e19
        // e.g. 1 * 1e18 / 1e17 + 1 = 11 => 11 * 1e17 / 1e18 = 1.1e18 / 1e18 = 1
        exchangeRate_ = exchangeRate;
        credits = _underlying.divPrecisely(exchangeRate_).add(1);
    }

    function _calcExchangeRate(uint256 _totalCollateral, uint256 _totalCredits)
        internal
        pure
        returns (uint256 _exchangeRate)
    {
        return _totalCollateral.divPrecisely(_totalCredits);
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
