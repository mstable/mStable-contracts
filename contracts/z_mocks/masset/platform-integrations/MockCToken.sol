pragma solidity 0.5.16;

import { ICERC20 } from "../../masset/platform-integrations/ICompound.sol";

import { IERC20, ERC20, ERC20Mintable } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import { StableMath } from "../../shared/StableMath.sol";


// 1. User calls 'getLendingPool'
// 2. User calls 'deposit' (Aave)
//  - Deposit their underlying
//  - Mint aToken to them
// 3. User calls redeem (aToken)
//  - Retrieve their aToken
//  - Return equal amount of underlying

contract MockCToken is ICERC20, ERC20Mintable {

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
    }

    function redeemUnderlying(uint redeemAmount) external returns (uint) {
        uint256 cTokens = redeemAmount.divPrecisely(exchangeRate);
        // Burn the cToken
        _burn(msg.sender, cTokens);
        // Send them back their reserve
        underlyingToken.transfer(msg.sender, redeemAmount);
    }

    function balanceOfUnderlying(address owner) external returns (uint) {
        uint256 cTokenBal = this.balanceOf(owner);
        return cTokenBal.mulTruncate(exchangeRate);
    }

    function updateExchangeRate() public returns (uint256){
        exchangeRate = exchangeRate.add(1e14);
    }

}
