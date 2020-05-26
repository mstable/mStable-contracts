pragma solidity 0.5.16;

import { SavingsContract } from "../../savings/SavingsContract.sol";
import { MockMasset } from "../../z_mocks/masset/MockMasset.sol";
import { MockNexus } from "../../z_mocks/nexus/MockNexus.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract EchidnaSavingsContract is SavingsContract {

    uint256 private constant ONE_BILLION = 10 ** 9;
    uint256 private constant ONE_MILLION = 10 ** 6;
    uint256 private constant TEN_BILLION = ONE_BILLION * 10;
    // Tokens
    uint256 private constant decimals = uint256(10) ** uint256(18);
    uint256 private constant TEN_BILLION_TOKENS = TEN_BILLION * decimals;
    uint256 private constant ONE_MILLION_TOKENS = ONE_MILLION * decimals;

    address private constant ATTACKER = address(0xdeadbeaf);

    // TODO Anyway to auto generate 100 tokens
    address[] private users = [
        address(0x1),
        address(0x2),
        address(0x3),
        address(0x4),
        address(0x5),
        address(0x6),
        address(0x7),
        address(0x8),
        address(0x9),
        address(0x10)
    ];

    address[] private senders;

    constructor() public SavingsContract(address(0x98), IERC20(0x99)) {
        address governor = address(0x1);
        address governance = address(0x1);
        address manager = address(0x1);
        address savingsManager = address(0x2);

        // Generate all tokens to this contract
        mUSD = new MockMasset("Mock", "MTK", 18, address(this), TEN_BILLION_TOKENS);
        MockNexus mockNexus = new MockNexus(
            governor,
            governance,
            manager
        );
        mockNexus.setSavingsManager(savingsManager);
        nexus = mockNexus;

        // Transfer tokens to users
        for(uint256 i = 0; i < users.length; i++) {
            mUSD.transfer(users[i], ONE_MILLION_TOKENS);
        }

        // Send remaining tokens to governor
        mUSD.transfer(governor, mUSD.balanceOf(address(this)));

        // Set auto interest collection to `false`
        automateInterestCollection = false;
    }

    // Allow any caller to approve tokens
    function approveToSavingsContract() public returns (bool) {
        MockMasset(address(mUSD)).approveInfinite(msg.sender, address(this));
    }


    // ==================================
    //          INVARIANTS
    // ==================================
    function echidna_savingsContract_must_maintain_savings_credit_exchange() public view returns (bool) {
        return totalSavings >= totalCredits * 1e18 / exchangeRate;
    }

    function echidna_savings_must_match_token_balance() public view returns (bool) {
        return totalSavings == mUSD.balanceOf(address(this));
    }

    // We have already set this flag as `false` to
    // avoid SavingsManager.collectAndDistributeInterest() function call
    function echidna_auto_interest_flag_must_always_be_false() public view returns (bool) {
        return automateInterestCollection == false;
    }

    function echidna_exchangeRate_must_not_be_zero() public view returns (bool) {
        return exchangeRate != 0;
    }

    function echidna_credits_must_be_equal_to_totalCredits() public view returns (bool) {
        uint256 total = 0;
        for(uint256 i = 0; i < users.length; i++) {
            total = total + creditBalances[users[i]];
        }

        return total == totalCredits;
    }

    function echidna_attacker_must_not_get_any_tokens() public view returns (bool) {
        return mUSD.balanceOf(ATTACKER) == 0;
    }

    function echidna_tokens_must_not_be_lost() public view returns (bool) {
        uint256 totalTokens = 0;
        // Total of users's balances
        for(uint256 i = 0; i < users.length; i++) {
            totalTokens = totalTokens + mUSD.balanceOf(users[i]);
        }

        // Tokens present in SavingsContract
        totalTokens = totalTokens + mUSD.balanceOf(address(this));
        return totalTokens == TEN_BILLION_TOKENS;
    }

    // ====================================================================
    // TEST FUNCTIONS TO ENSURE THAT THINGS ARE MOVING DURING TEST
    // ONCE WORKING, COMMENT OUT THESE FUNCTIONS
    // ====================================================================

    // function echidna_TEST_totalSavings() public view returns (bool) {
    //     return totalSavings == 0;
    // }

    // function echidna_TEST_token_balance() public view returns (bool) {
    //     return mUSD.balanceOf(address(this)) < 10000000000000;
    // }

}