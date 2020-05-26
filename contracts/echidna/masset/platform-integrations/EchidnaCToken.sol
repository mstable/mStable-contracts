pragma solidity 0.5.16;

import { ICERC20 } from "../../../masset/platform-integrations/ICompound.sol";

import { IERC20, ERC20, ERC20Mintable } from "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import { StableMath } from "../../../shared/StableMath.sol";
import { EchidnaInterface } from "../interfaces.sol";


// 1. User calls 'getLendingPool'
// 2. User calls 'deposit' (Aave)
//  - Deposit their underlying
//  - Mint aToken to them
// 3. User calls redeem (aToken)
//  - Retrieve their aToken
//  - Return equal amount of underlying

contract EchidnaCToken is ICERC20, ERC20Mintable {

    using StableMath for uint;

    ERC20 public underlyingToken;
    // underlying = cToken * exchangeRate
    // cToken = underlying / exchangeRate
    uint256 exchangeRate = 1e18;

    constructor(ERC20 _underlyingToken) public {
        underlyingToken = _underlyingToken;
    }


    function mint(uint mintAmount) external returns (uint) {
        // Pretend to inflate the cTokenExchangeRate
        updateExchangeRate();
        // Take their reserve
        underlyingToken.transferFrom(msg.sender, address(this), mintAmount);
        // Credit them with cToken
        _mint(msg.sender, mintAmount.divPrecisely(exchangeRate));
        return 0;
    }

    function redeemUnderlying(uint redeemAmount) external returns (uint) {
        // Pretend to inflate the cTokenExchangeRate
        updateExchangeRate();

        uint256 cTokens = redeemAmount.divPrecisely(exchangeRate);
        // Burn the cToken
        _burn(msg.sender, cTokens);
        // Send them back their reserve
        underlyingToken.transfer(msg.sender, redeemAmount);
        return 0;
    }

    function balanceOfUnderlying(address owner) external returns (uint) {
        // updateExchangeRate();
        uint256 cTokenBal = this.balanceOf(owner);
        return cTokenBal.mulTruncate(exchangeRate);
    }

    function updateExchangeRate() internal returns (uint256){
        exchangeRate = exchangeRate.add(1e14);
    }

    function exchangeRateStored() external view returns (uint) {
        return exchangeRate;
    }

    function echidna_exchange_rate_update_success() public returns(bool) {
        uint256 temp1 = exchangeRateStored();
        uint256 temp2 = updateExchangeRate(3);
        return temp2 > temp1;
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

}	}
}
