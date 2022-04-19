// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import { DSTest } from "../../lib/ds-test/src/test.sol";
import { TokenLocker } from "../TokenLocker.sol";
import { IERC20 } from "../../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

error LockupIsActive();
error OneDepositPerLockup();
error ReentrantCall();
error UnAuthorisedWithdrawal();
error ThresholdNotReached();
error UnAuthorisedBatchExecution();
error InvalidDeposit();
interface CheatCodes {
    function warp(uint256 x) external;
    function prank(address sender) external;
    function roll(uint256 x) external;
    function deal(address, uint256) external;
    function expectEmit(bool, bool, bool, bool) external;
    function addr(uint256 privateKey) external returns (address);
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert(bytes4) external;
}
contract LockerTest is DSTest {

    // Interfaces
    CheatCodes constant hack = CheatCodes(HEVM_ADDRESS);
    // Savings Contract mainnet
    address constant SAVINGS_CONTRACT_MAINNET = 0x30647a72Dc82d7Fbb1123EA74716aB8A317Eac19;
    address constant MASSET_ADDRESS_MAINNET = 0xe2f2a5C287993345a840Db3B0845fbC70f5935a5;

    // Token Locker Contract
    TokenLocker public locker = new TokenLocker(
        MASSET_ADDRESS_MAINNET, 
        SAVINGS_CONTRACT_MAINNET);
    // mUSD Interface
    IERC20 constant mUSD = IERC20(MASSET_ADDRESS_MAINNET);

    // Events
    event NewDeposit(address indexed _from, uint256 indexed _amount, uint256 indexed _time);
    event NewWithdrawal(address indexed _who, uint256 indexed _returned, uint256 indexed _time);
    event ExecutionComplete(uint256 indexed _amountExecuted, uint256 indexed _time);
    event Logger(string);
    event LogUsers(string key, address val);
    event NumLog(uint256);
    event KeyValLogger(string, uint256);
    event CanExecute(bool status);

    // Users
    address public annie;
    address public bob;
    address public charlie;

    // Starting masset pool to distribute amongst 3 users
    uint256 public massetStartAmount = 100000;
    

    function setUp() public {
        annie = hack.addr(1);
        bob = hack.addr(2);
        charlie = hack.addr(3);
        emit LogUsers("Annie:", annie);
        emit LogUsers("Bob:", bob);
        emit LogUsers("Charlie:", charlie);

        /**
        mUSD balances for the users are 
        initialised by calling the token's functions directly
        with the tokens own address using the prank hack.
        */
        hack.startPrank(MASSET_ADDRESS_MAINNET);
        mUSD.approve(MASSET_ADDRESS_MAINNET, massetStartAmount);
        mUSD.transferFrom(MASSET_ADDRESS_MAINNET, annie, 10000);
        mUSD.transferFrom(MASSET_ADDRESS_MAINNET, bob, 10000);
        mUSD.transferFrom(MASSET_ADDRESS_MAINNET, charlie, 10000);
        mUSD.approve(annie, 10000);
        mUSD.approve(bob, 10000);
        mUSD.approve(charlie, 10000);
        hack.stopPrank();

        emit Logger("mUSD balances initialised!");
    }

    function testBadWithdrawal() public {

        emit Logger("It should not allow withdrawals from user with no previous deposit");

        hack.startPrank(annie);
        hack.expectRevert(UnAuthorisedWithdrawal.selector);
        locker.withdraw(10);
        hack.stopPrank();
    }

    function testFailInsufficientCache() public {

        emit Logger("It should revert if mUSD threshold is not reached");

        hack.startPrank(annie);
        hack.expectRevert(ThresholdNotReached.selector);
        locker.batchExecute(SAVINGS_CONTRACT_MAINNET);
        hack.stopPrank();
    }

    function testZeroDepositAmount() public {

        emit Logger("It should revert if deposit amount is 0");

        hack.startPrank(bob);
        mUSD.approve(address(locker), 0);
        hack.expectRevert(InvalidDeposit.selector);
        locker.deposit(0);
        hack.stopPrank();
    }

    function testDeposit() public {

        emit Logger("It should only allow one deposit per user");

        uint256 depositValue = 5000;
        /**
        This hack block simulates a successful deposit from annie
        while also expecting a revert if annie makes more than one 
        deposit. 
        */
        hack.startPrank(annie);
        mUSD.approve(address(locker), 10000);
        hack.expectEmit(true, true, true, false);
        emit NewDeposit(annie, 5000, block.timestamp);
        locker.deposit(5000);
        hack.expectRevert(OneDepositPerLockup.selector);
        locker.deposit(100);
        hack.stopPrank();

        uint256 balance = locker.getBalance(annie);
        assertEq(balance, depositValue);
    }

    function testBadExecutor() public {
        
        emit Logger("It should revert on unauthorised batch execution");

        hack.startPrank(bob);
        mUSD.approve(address(locker), 8000);
        locker.deposit(8000);
        bool status = locker.checkExecutionStatus();
        emit CanExecute(status);
        hack.stopPrank();

        hack.expectRevert(UnAuthorisedBatchExecution.selector);
        hack.prank(charlie);
        locker.batchExecute(SAVINGS_CONTRACT_MAINNET);
    }

    function testBatchExecuteAndWithdrawals() public {

        emit Logger("It should allow batch execute after threshold reached");

        hack.startPrank(charlie);
        mUSD.approve(address(locker), 10000);
        locker.deposit(10000);
        bool status = locker.checkExecutionStatus();
        emit CanExecute(status);
        uint256 toExecute = mUSD.balanceOf(address(locker));
        hack.expectEmit(true, true, false, false);
        emit ExecutionComplete(toExecute, block.timestamp);
        locker.batchExecute(SAVINGS_CONTRACT_MAINNET);

        emit Logger("It should enforce lockup");

        hack.expectRevert(LockupIsActive.selector);
        locker.withdraw(100);
        hack.stopPrank();

        emit Logger("It should allow withdrawal after lockup period");

        // Annie deposits and executes batch transaction
        hack.startPrank(annie);
        mUSD.approve(address(locker), 10000);
        locker.deposit(10000);
        locker.batchExecute(SAVINGS_CONTRACT_MAINNET);

        // Tracks annie's credit balance and underlying before withdrawal
        uint256 creditBefore = locker.getCredit(annie);
        uint256 balanceBefore = locker.getBalance(annie);

        // Warps time forward to surpass lock duration
        uint256 _timeIn = locker.timeIn();
        hack.warp(_timeIn + 185 days);
        uint256 creditWithdrawal = 500;
        uint256 returned = locker.withdraw(creditWithdrawal);

        // Checks if annies credit balance after withdrawal reflects the amount deducted
        uint256 creditAfter = locker.getCredit(annie); 
        uint256 balanceAfter = locker.getBalance(annie);
        assertEq(balanceAfter, balanceBefore + returned);
        assertEq(creditAfter, creditBefore - creditWithdrawal);
    }
}

