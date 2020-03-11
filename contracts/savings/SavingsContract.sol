pragma solidity 0.5.16;

import { ISavingsContract } from "../interfaces/ISavingsContract.sol";

import { Module } from "../shared/Module.sol";

import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";

/**
 * @title SavingsContract
 */
contract SavingsContract is ISavingsContract, Module {

    using SafeMath for uint256;
    using StableMath for uint256;

    IERC20 private mUSD;

    uint256 public totalSavings; // Amount of mUSD saved in the contract
    uint256 public totalCredits; // Total number of savings credits issued

    // Rate between 'savings credits' and mUSD
    // e.g. 1 credit (1e18) mul exchangeRate / 1e18 = mUSD, starts at 1:1
    // exchangeRate increases over time and is essentially a percentage based value
    uint256 public exchangeRate = 1e18;
    mapping(address => uint256) public creditBalances; // Amount of credits for each saver

    constructor(
        address _nexus,
        IERC20 _mUSD
    )
        Module(_nexus)
        public
    {
        mUSD = _mUSD;
        totalSavings = 1;
        totalCredits = 1;
    }


    modifier onlySavingsManager() {
        require(msg.sender == _savingsManager(), "Only savings manager can execute");
        _;
    }

    /** @dev Deposit interest and update exchange rate of contract */
    function depositInterest(uint256 _amount)
        external
        onlySavingsManager
    {
        require(_amount > 0, "Must deposit something");

        // Call collect interest from the manager

        // Transfer the interest from sender to here
        require(mUSD.transferFrom(msg.sender, address(this), _amount), "Must receive tokens");
        totalSavings = totalSavings.add(_amount);

        // new exchange rate is relationship between totalCredits & totalSavings
        // totalCredits * exchangeRate = totalSavings
        // exchangeRate = totalSavings/totalCredits
        // e.g. (100e18 * 1e18) / 1e18 = 100e18
        // e.g. (101e20 * 1e18) / 100e20 = 101e18
        exchangeRate = totalSavings.divPrecisely(totalCredits);
    }

    /** @dev Add savings to the savings contract */
    function depositSavings(uint256 _amount)
        external
        returns (uint256 creditsIssued)
    {
        require(_amount > 0, "Must deposit something");
        // Transfer tokens from sender to here
        require(mUSD.transferFrom(msg.sender, address(this), _amount), "Must receive tokens");
        totalSavings = totalSavings.add(_amount);

        // Calc how many credits they receive based on currentRatio
        creditsIssued = _massetToCredit(_amount);
        totalCredits = totalCredits.add(creditsIssued);

        // add credits to balances
        creditBalances[msg.sender] = creditBalances[msg.sender].add(creditsIssued);
    }


    /**
     * @dev Redeem number of credits
     * @param _credits Amount of credits to redeem
     */
    function redeem(uint256 _credits)
        external
        returns (uint256 massetReturned)
    {
        require(_credits > 0, "Must withdraw something");

        uint256 saverCredits = creditBalances[msg.sender];
        require(saverCredits >= _credits, "Saver has no credits");

        creditBalances[msg.sender] = saverCredits.sub(_credits);
        totalCredits = totalCredits.sub(_credits);

        // Calc payout based on currentRatio
        massetReturned = _creditToMasset(_credits);
        totalSavings = totalSavings.sub(massetReturned);

        // Transfer tokens from here to sender
        require(mUSD.transfer(msg.sender, massetReturned), "Must send tokens");
    }

    function _massetToCredit(uint256 _amount)
        internal
        view
        returns (uint256 credits)
    {
        // e.g. (1e20 * 1e18) / 1e18 = 1e20
        // e.g. (1e20 * 1e18) / 14e17 = 7.1429e19
        credits = _amount.divPrecisely(exchangeRate);
    }

    function _creditToMasset(uint256 _credits)
        internal
        view
        returns (uint256 massetAmount)
    {
        // e.g. (1e20 * 1e18) / 1e18 = 1e20
        // e.g. (1e20 * 14e17) / 1e18 = 1.4e20
        massetAmount = _credits.mulTruncate(exchangeRate);
    }

}
