pragma solidity 0.5.16;

// External
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";

// Internal
import { ISavingsContractV1, ISavingsContractV2 } from "../interfaces/ISavingsContract.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { InitializableModule2 } from "../shared/InitializableModule2.sol";
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
 *          the value of the Savers "credits" (ERC20) relative to the amount of additional
 *          underlying collateral that has been deposited into this contract ("interest")
 * @dev     VERSION: 2.0
 *          DATE:    2020-12-15
 */
contract SavingsContract is
    ISavingsContractV1,
    ISavingsContractV2,
    Initializable,
    InitializableToken,
    InitializableModule2
{
    using SafeMath for uint256;
    using StableMath for uint256;

    // Core events for depositing and withdrawing
    event ExchangeRateUpdated(uint256 newExchangeRate, uint256 interestCollected);
    event SavingsDeposited(address indexed saver, uint256 savingsDeposited, uint256 creditsIssued);
    event CreditsRedeemed(address indexed redeemer, uint256 creditsRedeemed, uint256 savingsCredited);

    event AutomaticInterestCollectionSwitched(bool automationEnabled);

    // Connector poking
    event PokerUpdated(address poker);

    event FractionUpdated(uint256 fraction);
    event ConnectorUpdated(address connector);
    event EmergencyUpdate();

    event Poked(uint256 oldBalance, uint256 newBalance, uint256 interestDetected);
    event PokedRaw();

    // Rate between 'savings credits' and underlying
    // e.g. 1 credit (1e17) mulTruncate(exchangeRate) = underlying, starts at 10:1
    // exchangeRate increases over time
    uint256 private constant startingRate = 1e17;
    uint256 public exchangeRate;

    // Underlying asset is underlying
    IERC20 public underlying;
    bool private automateInterestCollection;

    // Yield
    // Poker is responsible for depositing/withdrawing from connector
    address public poker;
    // Last time a poke was made
    uint256 public lastPoke;
    // Last known balance of the connector
    uint256 public lastBalance;
    // Fraction of capital assigned to the connector (100% = 1e18)
    uint256 public fraction;
    // Address of the current connector (all IConnectors are mStable validated)
    IConnector public connector;
    // How often do we allow pokes
    uint256 constant private POKE_CADENCE = 4 hours;
    // Max APY generated on the capital in the connector
    uint256 constant private MAX_APY = 4e18;
    uint256 constant private SECONDS_IN_YEAR = 365 days;

    // Add these constants to bytecode at deploytime
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
        InitializableModule2._initialize(_nexus);

        require(address(_underlying) != address(0), "mAsset address is zero");
        underlying = _underlying;

        require(_poker != address(0), "Invalid poker address");
        poker = _poker;

        fraction = 2e17;
        automateInterestCollection = true;
        exchangeRate = startingRate;
    }

    /** @dev Only the savings managaer (pulled from Nexus) can execute this */
    modifier onlySavingsManager() {
        require(msg.sender == _savingsManager(), "Only savings manager can execute");
        _;
    }


    /***************************************
                    VIEW - E
    ****************************************/

    /**
     * @dev Returns the underlying balance of a given user
     * @param _user     Address of the user to check
     * @return balance  Units of underlying owned by the user
     */
    function balanceOfUnderlying(address _user) external view returns (uint256 balance) {
        (balance,) = _creditsToUnderlying(balanceOf(_user));
    }

    /**
     * @dev Converts a given underlying amount into credits
     * @param _underlying  Units of underlying
     * @return credits     Credit units (a.k.a imUSD)
     */
    function underlyingToCredits(uint256 _underlying) external view returns (uint256 credits) {
        (credits,) = _underlyingToCredits(_underlying);
    }

    /**
     * @dev Converts a given credit amount into underlying
     * @param _credits  Units of credits
     * @return amount   Corresponding underlying amount
     */
    function creditsToUnderlying(uint256 _credits) external view returns (uint256 amount) {
        (amount,) = _creditsToUnderlying(_credits);
    }

    // Deprecated in favour of `balanceOf(address)`
    // Maintained for backwards compatibility
    // Returns the credit balance of a given user
    function creditBalances(address _user) external view returns (uint256) {
        return balanceOf(_user);
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
        onlySavingsManager
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
            (uint256 totalCollat, ) = _creditsToUnderlying(totalCredits);
            uint256 newExchangeRate = _calcExchangeRate(totalCollat.add(_amount), totalCredits);
            exchangeRate = newExchangeRate;

            emit ExchangeRateUpdated(newExchangeRate, _amount);
        }
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
                    DEPOSIT
    ****************************************/

    /**
     * @dev During a migration period, allow savers to deposit underlying here before the interest has been redirected
     * @param _underlying      Units of underlying to deposit into savings vault
     * @param _beneficiary     Immediately transfer the imUSD token to this beneficiary address
     * @return creditsIssued   Units of credits (imUSD) issued
     */
    function preDeposit(uint256 _underlying, address _beneficiary)
        external
        returns (uint256 creditsIssued)
    {
        require(exchangeRate == startingRate, "Can only use this method before streaming begins");
        return _deposit(_underlying, _beneficiary, false);
    }

    /**
     * @dev Deposit the senders savings to the vault, and credit them internally with "credits".
     *      Credit amount is calculated as a ratio of deposit amount and exchange rate:
     *                    credits = underlying / exchangeRate
     *      We will first update the internal exchange rate by collecting any interest generated on the underlying.
     * @param _underlying      Units of underlying to deposit into savings vault
     * @return creditsIssued   Units of credits (imUSD) issued
     */
    function depositSavings(uint256 _underlying)
        external
        returns (uint256 creditsIssued)
    {
        return _deposit(_underlying, msg.sender, true);
    }

    /**
     * @dev Deposit the senders savings to the vault, and credit them internally with "credits".
     *      Credit amount is calculated as a ratio of deposit amount and exchange rate:
     *                    credits = underlying / exchangeRate
     *      We will first update the internal exchange rate by collecting any interest generated on the underlying.
     * @param _underlying      Units of underlying to deposit into savings vault
     * @param _beneficiary     Immediately transfer the imUSD token to this beneficiary address
     * @return creditsIssued   Units of credits (imUSD) issued
     */
    function depositSavings(uint256 _underlying, address _beneficiary)
        external
        returns (uint256 creditsIssued)
    {
        return _deposit(_underlying, _beneficiary, true);
    }

    /**
     * @dev Internally deposit the _underlying from the sender and credit the beneficiary with new imUSD
     */
    function _deposit(uint256 _underlying, address _beneficiary, bool _collectInterest)
        internal
        returns (uint256 creditsIssued)
    {
        require(_underlying > 0, "Must deposit something");
        require(_beneficiary != address(0), "Invalid beneficiary address");

        // Collect recent interest generated by basket and update exchange rate
        IERC20 mAsset = underlying;
        if(_collectInterest){
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(mAsset));
        }

        // Transfer tokens from sender to here
        require(mAsset.transferFrom(msg.sender, address(this), _underlying), "Must receive tokens");

        // Calc how many credits they receive based on currentRatio
        (creditsIssued,) = _underlyingToCredits(_underlying);

        // add credits to ERC20 balances
        _mint(_beneficiary, creditsIssued);

        emit SavingsDeposited(_beneficiary, _underlying, creditsIssued);
    }


    /***************************************
                    REDEEM
    ****************************************/


    // Deprecated in favour of redeemCredits
    // Maintaining backwards compatibility, this fn minimics the old redeem fn, in which
    // credits are redeemed but the interest from the underlying is not collected.
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

    /**
     * @dev Redeem credits into a specific amount of underlying.
     *      Credits needed to burn is calculated using:
     *                    credits = underlying / exchangeRate
     * @param _underlying     Amount of underlying to redeem
     * @return creditsBurned  Units of credits burned from sender
     */
    function redeemUnderlying(uint256 _underlying)
        external
        returns (uint256 creditsBurned)
    {
        require(_underlying > 0, "Must withdraw something");

        // Collect recent interest generated by basket and update exchange rate
        if(automateInterestCollection) {
            ISavingsManager(_savingsManager()).collectAndDistributeInterest(address(underlying));
        }

        // Ensure that the payout was sufficient
        (uint256 credits, uint256 massetReturned) = _redeem(_underlying, false);
        require(massetReturned == _underlying, "Invalid output");

        return credits;
    }

    /**
     * @dev Internally burn the credits and send the underlying to msg.sender
     */
    function _redeem(uint256 _amt, bool _isCreditAmt)
        internal
        returns (uint256 creditsBurned, uint256 massetReturned)
    {
        // Centralise credit <> underlying calcs and minimise SLOAD count
        uint256 credits_;
        uint256 underlying_;
        uint256 exchangeRate_;
        // If the input is a credit amt, then calculate underlying payout and cache the exchangeRate
        if(_isCreditAmt){
            credits_ = _amt;
            (underlying_, exchangeRate_) = _creditsToUnderlying(_amt);
        }
        // If the input is in underlying, then calculate credits needed to burn
        else {
            underlying_ = _amt;
            (credits_, exchangeRate_) = _underlyingToCredits(_amt);
        }

        // Burn required credits from the sender FIRST
        _burn(msg.sender, credits_);

        // Transfer tokens from here to sender
        require(underlying.transfer(msg.sender, underlying_), "Must send tokens");

        // If this withdrawal pushes the portion of stored collateral in the `connector` over a certain
        // threshold (fraction + 20%), then this should trigger a _poke on the connector. This is to avoid
        // a situation in which there is a rush on withdrawals for some reason, causing the connector
        // balance to go up and thus having too large an exposure.
        CachedData memory cachedData = _cacheData();
        ConnectorStatus memory status = _getConnectorStatus(cachedData, exchangeRate_);
        if(status.inConnector > status.limit){
            _poke(cachedData, false);
        }

        emit CreditsRedeemed(msg.sender, credits_, underlying_);

        return (credits_, underlying_);
    }


    struct ConnectorStatus {
        // Limit is the max amount of units allowed in the connector
        uint256 limit;
        // Derived balance of the connector
        uint256 inConnector;
    }

    /**
     * @dev Derives the units of collateral held in the connector
     * @param _data         Struct containing data on balances
     * @param _exchangeRate Current system exchange rate
     * @return status       Contains max amount of assets allowed in connector
     */
    function _getConnectorStatus(CachedData memory _data, uint256 _exchangeRate)
        internal
        pure
        returns (ConnectorStatus memory)
    {
        // Total units of underlying collateralised
        uint256 totalCollat = _data.totalCredits.mulTruncate(_exchangeRate);
        // Max amount of underlying that can be held in the connector
        uint256 limit = totalCollat.mulTruncate(_data.fraction.add(2e17));
        // Derives amount of underlying present in the connector
        uint256 inConnector = _data.rawBalance >= totalCollat ? 0 : totalCollat.sub(_data.rawBalance);

        return ConnectorStatus(limit, inConnector);
    }

    /***************************************
                    YIELD - E
    ****************************************/


    /** @dev Modifier allowing only the designated poker to execute the fn */
    modifier onlyPoker() {
        require(msg.sender == poker, "Only poker can execute");
        _;
    }

    /**
     * @dev External poke function allows for the redistribution of collateral between here and the
     * current connector, setting the ratio back to the defined optimal.
     */
    function poke()
        external
        onlyPoker
    {
        CachedData memory cachedData = _cacheData();
        _poke(cachedData, false);
    }

    /**
     * @dev Governance action to set the address of a new poker
     * @param _newPoker     Address of the new poker
     */
    function setPoker(address _newPoker)
        external
        onlyGovernor
    {
        require(_newPoker != address(0) && _newPoker != poker, "Invalid poker");

        poker = _newPoker;

        emit PokerUpdated(_newPoker);
    }

    /**
     * @dev Governance action to set the percentage of assets that should be held
     * in the connector.
     * @param _fraction     Percentage of assets that should be held there (where 20% == 2e17)
     */
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

    /**
     * @dev Governance action to set the address of a new connector, and move funds (if any) across.
     * @param _newConnector     Address of the new connector
     */
    function setConnector(address _newConnector)
        external
        onlyGovernor
    {
        // Withdraw all from previous by setting target = 0
        CachedData memory cachedData = _cacheData();
        cachedData.fraction = 0;
        _poke(cachedData, true);

        // Set new connector
        CachedData memory cachedDataNew = _cacheData();
        connector = IConnector(_newConnector);
        _poke(cachedDataNew, true);

        emit ConnectorUpdated(_newConnector);
    }

    /**
     * @dev Governance action to perform an emergency withdraw of the assets in the connector,
     * should it be the case that some or all of the liquidity is trapped in. This causes the total
     * collateral in the system to go down, causing a hard refresh.
     */
    function emergencyWithdraw(uint256 _withdrawAmount)
        external
        onlyGovernor
    {
        // withdraw _withdrawAmount from connection
        connector.withdraw(_withdrawAmount);

        // reset the connector
        connector = IConnector(address(0));
        emit ConnectorUpdated(address(0));

        // set fraction to 0
        fraction = 0;
        emit FractionUpdated(0);

        // check total collateralisation of credits
        CachedData memory data = _cacheData();
        // use rawBalance as the remaining liquidity in the connector is now written off
        _refreshExchangeRate(data.rawBalance, data.totalCredits, true);

        emit EmergencyUpdate();
    }


    /***************************************
                    YIELD - I
    ****************************************/

    /** @dev Internal poke function to keep the balance between connector and raw balance healthy */
    function _poke(CachedData memory _data, bool _ignoreCadence) internal {
        require(_data.totalCredits > 0, "Must have something to poke");

        // 1. Verify that poke cadence is valid, unless this is a manual action by governance
        uint256 currentTime = uint256(now);
        uint256 timeSinceLastPoke = currentTime.sub(lastPoke);
        require(_ignoreCadence || timeSinceLastPoke > POKE_CADENCE, "Not enough time elapsed");
        lastPoke = currentTime;

        // If there is a connector, check the balance and settle to the specified fraction %
        IConnector connector_ = connector;
        if(address(connector_) != address(0)){

            // 2. Check and verify new connector balance
            uint256 lastBalance_ = lastBalance;
            uint256 connectorBalance = connector_.checkBalance();
            //      Always expect the collateral in the connector to increase in value
            require(connectorBalance >= lastBalance_, "Invalid yield");
            if(connectorBalance > 0){
                //  Validate the collection by ensuring that the APY is not ridiculous
                _validateCollection(connectorBalance, connectorBalance.sub(lastBalance_), timeSinceLastPoke);
            }

            // 3. Level the assets to Fraction (connector) & 100-fraction (raw)
            uint256 sum = _data.rawBalance.add(connectorBalance);
            uint256 ideal = sum.mulTruncate(_data.fraction);
            //     If there is not enough mAsset in the connector, then deposit
            if(ideal > connectorBalance){
                uint256 deposit = ideal.sub(connectorBalance);
                underlying.approve(address(connector_), deposit);
                connector_.deposit(deposit);
            }
            //     Else withdraw, if there is too much mAsset in the connector
            else if(connectorBalance > ideal) {
                // If fraction == 0, then withdraw everything
                if(ideal == 0){
                    connector_.withdrawAll();
                    sum = IERC20(underlying).balanceOf(address(this));
                } else {
                    connector_.withdraw(connectorBalance.sub(ideal));
                }
            }
            //     Else ideal == connectorBalance (e.g. 0), do nothing
            require(connector_.checkBalance() >= ideal, "Enforce system invariant");

            // 4i. Refresh exchange rate and emit event
            lastBalance = ideal;
            _refreshExchangeRate(sum, _data.totalCredits, false);
            emit Poked(lastBalance_, ideal, connectorBalance.sub(lastBalance_));

        } else {

            // 4ii. Refresh exchange rate and emit event
            lastBalance = 0;
            _refreshExchangeRate(_data.rawBalance, _data.totalCredits, false);
            emit PokedRaw();

        }
    }


    /**
     * @dev Internal fn to refresh the exchange rate, based on the sum of collateral and the number of credits
     * @param _realSum          Sum of collateral held by the contract
     * @param _totalCredits     Total number of credits in the system
     * @param _ignoreValidation This is for use in the emergency situation, and ignores a decreasing exchangeRate
     */
    function _refreshExchangeRate(uint256 _realSum, uint256 _totalCredits, bool _ignoreValidation) internal {
        // Based on the current exchange rate, how much underlying is collateralised?
        (uint256 totalCredited, ) = _creditsToUnderlying(_totalCredits);

        // Require the amount of capital held to be greater than the previously credited units
        require(_ignoreValidation || _realSum >= totalCredited, "ExchangeRate must increase");
        // Work out the new exchange rate based on the current capital
        uint256 newExchangeRate = _calcExchangeRate(_realSum, _totalCredits);
        exchangeRate = newExchangeRate;

        emit ExchangeRateUpdated(newExchangeRate, _realSum > totalCredited ? _realSum.sub(totalCredited) : 0);
    }

    /**
     * FORKED DIRECTLY FROM SAVINGSMANAGER.sol
     * ---------------------------------------
     * @dev Validates that an interest collection does not exceed a maximum APY. If last collection
     * was under 30 mins ago, simply check it does not exceed 10bps
     * @param _newBalance              New balance of the underlying
     * @param _interest                Increase in total supply since last collection
     * @param _timeSinceLastCollection Seconds since last collection
     */
    function _validateCollection(uint256 _newBalance, uint256 _interest, uint256 _timeSinceLastCollection)
        internal
        pure
        returns (uint256 extrapolatedAPY)
    {
        // Protect against division by 0
        uint256 protectedTime = StableMath.max(1, _timeSinceLastCollection);

        uint256 oldSupply = _newBalance.sub(_interest);
        uint256 percentageIncrease = _interest.divPrecisely(oldSupply);

        uint256 yearsSinceLastCollection =
            protectedTime.divPrecisely(SECONDS_IN_YEAR);

        extrapolatedAPY = percentageIncrease.divPrecisely(yearsSinceLastCollection);

        if(protectedTime > 30 minutes) {
            require(extrapolatedAPY < MAX_APY, "Interest protected from inflating past maxAPY");
        } else {
            require(percentageIncrease < 1e15, "Interest protected from inflating past 10 Bps");
        }
    }


    /***************************************
                    VIEW - I
    ****************************************/

    struct CachedData {
        // SLOAD from 'fraction'
        uint256 fraction;
        // ERC20 balance of underlying, held by this contract
        // underlying.balanceOf(address(this))
        uint256 rawBalance;
        // totalSupply()
        uint256 totalCredits;
    }

    /**
     * @dev Retrieves generic data to avoid duplicate SLOADs
     */
    function _cacheData() internal view returns (CachedData memory) {
        uint256 balance = underlying.balanceOf(address(this));
        return CachedData(fraction, balance, totalSupply());
    }

    /**
     * @dev Converts masset amount into credits based on exchange rate
     *               c = (masset / exchangeRate) + 1
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

    /**
     * @dev Works out a new exchange rate, given an amount of collateral and total credits
     *               e = underlying / (credits-1)
     */
    function _calcExchangeRate(uint256 _totalCollateral, uint256 _totalCredits)
        internal
        pure
        returns (uint256 _exchangeRate)
    {
        _exchangeRate = _totalCollateral.divPrecisely(_totalCredits.sub(1));
    }

    /**
     * @dev Converts credit amount into masset based on exchange rate
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
