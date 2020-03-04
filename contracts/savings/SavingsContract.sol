pragma solidity 0.5.16;

import { ISavingsContract } from "../interfaces/ISavingsContract.sol";
import { IMasset } from "../interfaces/IMasset.sol";

import { Module } from "../shared/Module.sol";

import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title SavingsContract
 */
contract SavingsContract is ISavingsContract, Module {

    using SafeMath for uint256;

    IMasset private mUSD;

    uint256 public currentRatio = 1e18;
    uint256 public totalCredits = 0;
    uint256 public totalSavings = 0;

    mapping(address => uint256) public creditBalances;

    constructor(
        address _nexus,
        IMasset _mUSD
    )
        Module(_nexus)
        public
    {
        mUSD = _mUSD;
    }


    modifier onlySavingsManager() {
        require(msg.sender == _savingsManager(), "Only savings manager can execute");
        _;
    }

    /** @dev Deposit interest and update exchange rate of contract */
    function depositInterest(uint256 _amount) external onlySavingsManager {
        // Transfer the interest from sender to here
        // Calc interest as a portion of the total collateral
        // new exchange rate = currentRatio * (_amount as portion of totalSavings*oldExchangeRate)
    }


    /** @dev Add savings to the savings contract */
    function save(uint256 _amount) external {
        // Transfer tokens from sender to here
        // Calc how many credits they receive based on currentRatio
        // add credits to balances
    }

    /**
     * @dev Withdraw relevant collat
     * @param _amount Amount of credits to withdraw
     */
    function withdraw(uint256 _amount) external {
        // calc payout in mUSD based on credits * exchange rate
    }

}
