pragma solidity 0.5.16;

import { SavingsManager } from "../../savings/SavingsManager.sol";
import { SavingsContract } from "../../savings/SavingsContract.sol";
import { ISavingsContract } from "../../interfaces/ISavingsContract.sol";
import { MockMasset } from "../../z_mocks/masset/MockMasset.sol";
import { MockNexus } from "../../z_mocks/nexus/MockNexus.sol";

contract EchidnaSavingsManager {

    MockMasset private mAsset;
    MockNexus private nexus;
    SavingsManager private savingsManager;
    SavingsContract private savingsContract;

    address[] private addedMassets;
    uint256 private savingsRate = 1e18;
    uint256 private collectAndDistributeInterestCount = 0;

    uint256 private constant INTEREST_TO_MINT = 100;
    uint256 private constant TEN_MILLION = 10 ** 6;
    uint256 private constant THOUSAND_TOKENS = 1000 * uint256(10) ** uint256(18);
    address private constant unallocatedBalRecipient = address(0xdeadbeaf);

    constructor() public {
        mAsset = new MockMasset("Mock", "MTK", 18, address(this), TEN_MILLION);
        assert(mAsset.balanceOf(msg.sender) == 0);

        // Make this contract Governor, so that it can call functions on SavingsManager
        address governor = address(this);
        address governance = address(this);
        address manager = address(this);
        nexus = new MockNexus(
            governor,
            governance,
            manager
        );

        savingsContract = new SavingsContract(address(nexus), mAsset);

        savingsManager = new SavingsManager(
            address(nexus),
            address(mAsset),
            address(savingsContract)
        );

        nexus.setSavingsManager(address(savingsManager));

        // Allow SavingsContract to fetch mAsset tokens from this contract
        mAsset.approve(address(savingsContract), THOUSAND_TOKENS);
    }

    // ==================================
    //          INVARIANTS
    // ==================================
    function echidna_savingsContract_must_not_set_back_to_zero() public view returns (bool) {
        return savingsManager.savingsContracts(address(mAsset)) != ISavingsContract(address(0x0));
    }

    function echidna_savingsContracts_must_not_have_zero_address() public view returns (bool) {
        return savingsManager.savingsContracts(address(0)) == ISavingsContract(address(0));
    }

    function echidna_lastCollection_must_not_have_zero_address() public view returns (bool) {
        return savingsManager.lastCollection(address(0)) == 0;
    }

    function echidna_all_mAssets_must_have_non_zero_savingsContract_address() public view returns (bool) {
        bool isValid = true;
        for(uint256 i = 0; i < addedMassets.length; i++) {
            isValid =
                isValid &&
                (
                    savingsManager.savingsContracts(addedMassets[i]) != ISavingsContract(address(0))
                );
        }

        return isValid;
    }

    function echidna_savingsRate_must_always_in_limit() public view returns (bool) {
        return (savingsRate > 9e17 && savingsRate <= 1e18);
    }

    // TODO This MUST FAIL as there is no check in the contract
    function echidna_each_masset_have_unique_savingsContract() public view returns (bool) {
        bool isValid = true;
        for(uint256 i = 0; i < addedMassets.length; i++) {
            ISavingsContract current = savingsManager.savingsContracts(addedMassets[i]);
            for(uint256 j = i+1; j < addedMassets.length; j++) {
                ISavingsContract other = savingsManager.savingsContracts(addedMassets[j]);
                isValid = isValid && (current != other);
            }
        }
        return isValid;
    }

    function echidna_savingsContract_must_maintain_savings_credit_exchange() public view returns (bool) {
        uint256 totalSavings = savingsContract.totalSavings();
        uint256 totalCredits = savingsContract.totalCredits();
        uint256 exchangeRate = savingsContract.exchangeRate();
        return totalSavings >= totalCredits * 1e18 / exchangeRate;
    }

    function echidna_savingsContract_token_balance_match_totalSavings() public view returns (bool) {
        uint256 totalSavings = savingsContract.totalSavings();
        uint256 savingsContractBalance = mAsset.balanceOf(address(savingsContract));
        return savingsContractBalance == totalSavings;
    }

    function echidna_unallocated_token_balance() public view returns (bool) {
        uint256 bal = mAsset.balanceOf(unallocatedBalRecipient);
        uint256 maxUnallocatedBal = (INTEREST_TO_MINT * collectAndDistributeInterestCount) / 10; // 10%
        return bal >= 0 && bal <= maxUnallocatedBal;
    }

    // MUST FAIL once working
    function echidna_check_MUST_FAIL_unallocated_token_balance() public view returns (bool) {
        uint256 bal = mAsset.balanceOf(unallocatedBalRecipient);
        return bal == 0;
    }

    // ====================================================================
    // TEST FUNCTIONS TO ENSURE THAT THINGS ARE MOVING DURING TEST
    // ONCE WORKING, COMMENT OUT THESE FUNCTIONS
    // ====================================================================

    // function echidna_masset_token_balanceOf_this() public view returns (bool) {
    //     return mAsset.balanceOf(address(this)) == TEN_MILLION * uint256(10) ** uint256(18);
    // }

    // function echidna_masset_token_totalSupply() public view returns (bool) {
    //     return mAsset.totalSupply() == TEN_MILLION * uint256(10) ** uint256(18);
    // }

    // function echidna_masset_allowance_should_change() public view returns (bool) {
    //     return mAsset.allowance(address(savingsManager), address(savingsContract)) == uint256(-1);
    // }


    // ==================================
    //  DELEGATE CALL To SavingsManager
    // ==================================
    function addSavingsContract(address _mAsset, address _savingsContract) public {
        // If address is pushed to array meaning tx is successful.
        // In case tx is reverted, entry will not be added in the array
        addedMassets.push(_mAsset);
        savingsManager.addSavingsContract(_mAsset, _savingsContract);
    }

    function updateSavingsContract(address _mAsset, address _savingsContract) public {
        savingsManager.updateSavingsContract(_mAsset, _savingsContract);
    }

    function setSavingsRate(uint256 _savingsRate) public {
        savingsManager.setSavingsRate(_savingsRate);
        // `savingsRate` is defined private in the contract
        // Without changing contract code, we can verify the value here
        // If the below code is executed meaning that the function call is successful
        // Hence, storing the argument in `savingsRate` state variable of this contract.
        savingsRate = _savingsRate;
    }

    
    function collectAndDistributeInterest(address _mAsset) public {
        bool isGoingToMint = false;
        if(mAsset.amountToMint() > 0) isGoingToMint = true;

        savingsManager.collectAndDistributeInterest(_mAsset);
        
        // Interest minted, hence keep the count
        // when amountToMint == 0 then only its minted
        if(isGoingToMint && mAsset.amountToMint() == 0) {
            collectAndDistributeInterestCount++;
        }
    }

    function withdrawUnallocatedInterest(address _mAsset) public {
        savingsManager.withdrawUnallocatedInterest(_mAsset, unallocatedBalRecipient);
    }

    // ==================================
    //  DELEGATE CALL To SavingsContract
    // ==================================
    function depositSavings(uint256 _amount) public {
        savingsContract.depositSavings(_amount);
    }

    // ==================================
    //  DELEGATE CALL To MockMasset
    // ==================================
    function setAmountForCollectInterest() public {
        // mint interest as very small value
        mAsset.setAmountForCollectInterest(INTEREST_TO_MINT);
    }
}