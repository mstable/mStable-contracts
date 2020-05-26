pragma solidity 0.5.16;

import { EchidnaERC20 } from "../shared/EchidnaERC20.sol";
import { EchidnaInterface } from "../interfaces.sol";

contract EchidnaMasset is EchidnaERC20 {

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    )
        public
        EchidnaERC20(
            _name,
            _symbol,
            _decimals,
            _initialRecipient,
            _initialMint
        )

    {}

    uint256 private amountToMint = 0;

    // Inject amount of tokens to mint
    function setAmountForCollectInterest(uint256 _amount) public {
        amountToMint = _amount;
    }

    function collectInterest()
        external
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        _mint(msg.sender, amountToMint);
        totalInterestGained = amountToMint;
        newSupply = totalSupply();
        // Set back to zero
        amountToMint = 0;
    }

    function init_total_supply() public returns(bool){
		return this.totalSupply() >= 0 && this.totalSupply() == initialTotalSupply;
	}

	function init_owner_balance() public returns(bool){
		return initialBalance_owner == this.balanceOf(echidna_owner);
	}

	function init_user_balance() public returns(bool){
		return initialBalance_user == this.balanceOf(echidna_user);
	}

	function init_attacker_balance() public returns(bool){
		return initialBalance_attacker == this.balanceOf(echidna_attacker);
	}

	function init_caller_balance() public returns(bool){
		return this.balanceOf(msg.sender) > 0;
	}

	function init_total_supply_is_balances() public returns(bool){
		return this.balanceOf(echidna_owner) + this.balanceOf(echidna_user) + this.balanceOf(echidna_attacker) == this.totalSupply();
	}
	function echidna_zero_always_empty_ERC20() public returns(bool){
		return this.balanceOf(address(0x0)) == 0;
	}

	function echidna_approve_overwrites() public returns(bool){
		bool approve_return; 
		approve_return = approve(echidna_user, 10);
		require(approve_return);
		approve_return = approve(echidna_user, 20);
		require(approve_return);
		return this.allowance(msg.sender, echidna_user) == 20;
	}

	function echidna_less_than_total_ERC20() public returns(bool){
		return this.balanceOf(msg.sender) <= totalSupply();
	}

	function echidna_totalSupply_consistant_ERC20() public returns(bool){
		return this.balanceOf(echidna_owner) + this.balanceOf(echidna_user) + this.balanceOf(echidna_attacker) <= totalSupply();
	}

	function echidna_revert_transfer_to_zero_ERC20() public returns(bool){
		if (this.balanceOf(msg.sender) == 0){
			revert();
		}
		return transfer(address(0x0), this.balanceOf(msg.sender));
	}

	function echidna_revert_transferFrom_to_zero_ERC20() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		if (balance == 0){
			revert();
		}
		approve(msg.sender, balance);
		return transferFrom(msg.sender, address(0x0), this.balanceOf(msg.sender));
	}

	function echidna_self_transferFrom_ERC20() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		bool approve_return = approve(msg.sender, balance);
		bool transfer_return = transferFrom(msg.sender, msg.sender, balance);
		return (this.balanceOf(msg.sender) == balance) && approve_return && transfer_return;
	}

	function echidna_self_transferFrom_to_other_ERC20() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		bool approve_return = approve(msg.sender, balance);
		address other = echidna_user;
		if (other == msg.sender) {
			other = echidna_owner;
		}
		bool transfer_return = transferFrom(msg.sender, other, balance);
		return (this.balanceOf(msg.sender) == 0) && approve_return && transfer_return;
	}

	function echidna_self_transfer_ERC20() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		bool transfer_return = transfer(msg.sender, balance);
		return (this.balanceOf(msg.sender) == balance) && transfer_return;
	}

	function echidna_transfer_to_other_ERC20() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		address other = echidna_user;
		if (other == msg.sender) {
			other = echidna_owner;
		}
		if (balance >= 1) {
			bool transfer_other = transfer(other, 1);
			return (this.balanceOf(msg.sender) == balance-1) && (this.balanceOf(other) >= 1) && transfer_other;
		}
		return true;
	}

	function echidna_revert_transfer_to_user_ERC20() public returns(bool){
		uint balance = this.balanceOf(msg.sender);
		if (balance == (2 ** 256 - 1))
			return true;
		bool transfer_other = transfer(echidna_user, balance+1);
		return transfer_other;
	}

}
contract EchidnaMasset1 is EchidnaERC20 {

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    )
        public
        EchidnaERC20(
            _name,
            _symbol,
            _decimals,
            _initialRecipient,
            _initialMint
        )

    {}

    uint256 private amountToMint = 0;

    // Inject amount of tokens to mint
    function setAmountForCollectInterest(uint256 _amount) public {
        amountToMint = _amount;
    }

    function collectInterest()
        external
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        totalInterestGained = amountToMint;
        newSupply = totalSupply();
        // Set back to zero
        amountToMint = 0;
    }

	function echidna_amount_to_mint_under_total_supply() public returns (bool) {
		return (amountToMint <= totalSupply())
	}

}