// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISavingsContractV3 } from "../interfaces/ISavingsContract.sol";

// Thrown when trying to withdraw before end of lockup
error LockupIsActive();
// Thrown when user tries to deposit twice
error OneDepositPerLockup();
// Thrown on reentrancy attempt
error ReentrantCall();
// Thrown when user who hasn't deposited tries to withdraw
error UnAuthorisedWithdrawal();
// Thrown when batch execute is called before cache threshhold
error ThresholdNotReached();
// Thrown when user who has not deposited tries to initialise a batch execution
error UnAuthorisedBatchExecution();
// Thrown when depositing 0 quantity
error InvalidDeposit();

/**
 * @title TokenLocker
 * @author Emmett
 * @notice The TockenLocker contract allows users to
 *         deposit $mUSD tokens which are then deposited into
 *         mStable's SavingsContract.
 */

contract TokenLocker {
    /***************************************
            EVENTS & STATE VARIABLES
    ****************************************/

    // The new deposit event tracks the from address, amount deposited, and timestamp of deposit.
    event NewDeposit(address indexed _from, uint256 indexed _amount, uint256 indexed _time);
    event NewWithdrawal(address indexed _who, uint256 indexed _returned, uint256 indexed _time);
    event ExecutionComplete(uint256 indexed _amountExecuted, uint256 indexed _time);

    ISavingsContractV3 public savingsInterface;
    IERC20 public mUSD;

    // 6 months in days
    uint256 public constant LOCK_DURATION = 183 days;

    // store user balances and time in
    mapping(address => uint256) public userBalances;
    mapping(address => uint256) public userCreditBalance;
    mapping(address => bool) public depositStatus;
    uint256 public timeIn;

    // Batch execute enabled if mUSD == threshold
    uint256 public contractCache = 10000;

    /**
    @notice For this test, I've decided to use my own implementation of a 
    *       reentrancy guard which uses two 128bit integers to optimise storage. 
    *       My implementation also uses a custom error message as opposed to a 
    *       require statement to avoid unecessary strings.
    */
    uint128 private constant NOT_ENTERED = 1;
    uint128 private constant IS_ENTERED = 2;
    uint256 private _status;

    constructor(address _masset, address _savingsContract) {
        // initiates the current status to not entered
        _status = NOT_ENTERED;

        mUSD = IERC20(_masset);
        savingsInterface = ISavingsContractV3(_savingsContract);
    }

    /***************************************
                    MODIFIERS
    ****************************************/

    modifier nonReentrant {
        /**
         * @dev To prevent reentrancy, the modifier first checks that the status
         *      is not entered and throws a custom revert error if the call is reentrant.
         */
        if (_status == IS_ENTERED) revert ReentrantCall();
        // The modifier sets the status to entered for the duration of function execution.
        _status = IS_ENTERED;
        _;
        // Restores the default value to not entered.
        _status = NOT_ENTERED;
    }

    modifier enforceLockup {
        uint256 _timeIn = timeIn;
        if (block.timestamp < _timeIn + LOCK_DURATION) revert LockupIsActive();
        _;
    }

    modifier checkThreshold {
        uint256 cache = contractCache;
        uint256 massetBalance = mUSD.balanceOf(address(this));
        if (massetBalance > cache) revert ThresholdNotReached();
        _;
    }

    /***************************************
                    MAIN LOGIC
    ****************************************/

    function deposit(uint256 amount) external nonReentrant {
        // throws a custom error if user has already deposited
        if (depositStatus[msg.sender] == true) revert OneDepositPerLockup();
        if (amount == 0) revert InvalidDeposit();
        // Tracks initial deposit balance
        userBalances[msg.sender] = amount;
        // sets caller's deposit status
        depositStatus[msg.sender] = true;

        // updates user's credit balance with underlyingToCredits return value
        uint256 credit = savingsInterface.underlyingToCredits(amount);
        userCreditBalance[msg.sender] = credit;

        // user approves tocken locker to spend their mUSD
        // updates cache balance before making external transfer call
        mUSD.transferFrom(msg.sender, address(this), amount);

        emit NewDeposit(msg.sender, amount, block.timestamp);
    }

    function batchExecute(address savingsContract) external checkThreshold nonReentrant {
        // only users who have previously deposited may initialise a batch execution
        if (depositStatus[msg.sender] == false) revert UnAuthorisedBatchExecution();
        timeIn = block.timestamp;
        // create variable copy to avoid reading directly from state variables
        uint256 amountToExecute = mUSD.balanceOf(address(this));
        // approves savings contract to spend tocken locker's mUSD cache
        mUSD.approve(savingsContract, amountToExecute);

        // deposits amount to execute into savings contract
        savingsInterface.depositSavings(amountToExecute, address(this));

        emit ExecutionComplete(amountToExecute, block.timestamp);
    }

    function withdraw(uint256 amount) external nonReentrant enforceLockup returns (uint256) {
        if (depositStatus[msg.sender] == false) revert UnAuthorisedWithdrawal();
        // checks if user has enough credits
        uint256 _credit = userCreditBalance[msg.sender];
        require(amount <= _credit, "Insufficient Balance");
        // caches return value from redeeming with users credit balance
        uint256 returned = savingsInterface.redeemCredits(amount);

        // replaces users balance with return value (principle + interest) and emits event
        userBalances[msg.sender] += returned;
        userCreditBalance[msg.sender] -= amount;
        mUSD.approve(address(this), returned);
        mUSD.transferFrom(address(this), msg.sender, returned);
        emit NewWithdrawal(msg.sender, returned, block.timestamp);

        return returned;
    }

    /***************************************
                VIEW FUNCTIONS
    ****************************************/

    function getBalance(address target) external view returns (uint256 balance) {
        (balance) = userBalances[target];
    }

    function getCredit(address target) external view returns (uint256 credit) {
        (credit) = userCreditBalance[target];
    }

    function userStatus(address target) external view returns (bool status) {
        (status) = depositStatus[target];
    }

    function checkExecutionStatus() external view returns (bool canExecute) {
        uint256 _cache = contractCache;
        uint256 massetBalance = mUSD.balanceOf(address(this));
        if (massetBalance >= _cache) {
            return true;
        }
    }
}
