pragma solidity 0.5.16;

// External
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";

// Internal
import { ISavingsContract } from "../interfaces/ISavingsContract.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { InitializableModule } from "../shared/InitializableModule.sol";

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
contract SavingsContract is ISavingsContract, InitializableToken, InitializableModule {

    using SafeMath for uint256;
    using StableMath for uint256;

    // Core events for depositing and withdrawing
    event ExchangeRateUpdated(uint256 newExchangeRate, uint256 interestCollected);
    event SavingsDeposited(address indexed saver, uint256 savingsDeposited, uint256 creditsIssued);
    event CreditsRedeemed(address indexed redeemer, uint256 creditsRedeemed, uint256 savingsCredited);
    event AutomaticInterestCollectionSwitched(bool automationEnabled);

    // Rate between 'savings credits' and underlying
    // e.g. 1 credit (1e17) mulTruncate(exchangeRate) = underlying, starts at 10:1
    // exchangeRate increases over time
    uint256 public exchangeRate = 1e17;

    // Underlying asset is underlying
    IERC20 public underlying;
    bool private automateInterestCollection = true;

    // TODO - use constant addresses during deployment. Adds to bytecode
    constructor(
        address _nexus, // constant
        IERC20 _underlying, // constant
        string memory _nameArg, // constant
        string memory _symbolArg // constant
    )
        public
    {
        require(address(_underlying) != address(0), "mAsset address is zero");
        underlying = _underlying;
        InitializableToken._initialize(_nameArg, _symbolArg);
        InitializableModule._initialize(_nexus);
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

    modifier onlyPoker() {
        // require(msg.sender == poker);
        _;
    }

    // Protects against initiailisation case
    function pokeSurplus()
        external
        onlyPoker
    {
        uint256 sum = _creditToUnderlying(totalSupply());
        uint256 balance = underlying.balanceOf(address(this));
        if(balance > sum){
            exchangeRate = balance.divPrecisely(totalSupply());
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

    function deposit(uint256 _underlying, address _beneficiary)
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
        massetReturned = _creditToUnderlying(_credits);

        // Transfer tokens from here to sender
        require(underlying.transfer(msg.sender, massetReturned), "Must send tokens");

        emit CreditsRedeemed(msg.sender, _credits, massetReturned);
    }
    

    /***************************************
                    VIEWING
    ****************************************/

    function balanceOfUnderlying(address _user) external view returns (uint256 balance) {
        return _creditToUnderlying(balanceOf(_user));
    }


    function creditBalances(address _user) external view returns (uint256) {
        return balanceOf(_user);
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
    function _creditToUnderlying(uint256 _credits)
        internal
        view
        returns (uint256 underlyingAmount)
    {
        // e.g. (1e20 * 1e18) / 1e18 = 1e20
        // e.g. (1e20 * 14e17) / 1e18 = 1.4e20
        underlyingAmount = _credits.mulTruncate(exchangeRate);
    }
}
