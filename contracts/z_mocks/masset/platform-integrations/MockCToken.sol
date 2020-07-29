pragma solidity 0.5.16;

import { ICERC20 } from "../../../masset/platform-integrations/ICompound.sol";

import { IERC20, ERC20, ERC20Mintable } from "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Detailed } from "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import { StableMath } from "../../../shared/StableMath.sol";


// 1. User calls 'getLendingPool'
// 2. User calls 'deposit' (Aave)
//  - Deposit their underlying
//  - Mint aToken to them
// 3. User calls redeem (aToken)
//  - Retrieve their aToken
//  - Return equal amount of underlying

contract MockCToken is ICERC20, ERC20, ERC20Detailed, ERC20Mintable {

    using StableMath for uint;

    IERC20 public underlyingToken;
    // underlying = cToken * exchangeRate
    // cToken = underlying / exchangeRate
    uint256 exchangeRate;

    constructor(ERC20Detailed _underlyingToken) public ERC20Detailed("cMock", "cMK", 8) {
        uint8 underlyingDecimals = _underlyingToken.decimals();
        // if has 18 dp, exchange rate should be 1e26
        // if has 8 dp, echange rate should be 1e18
        if(underlyingDecimals > 8) {
            exchangeRate = 10 ** uint256(18 + underlyingDecimals - 10);
        } else if(underlyingDecimals < 8) {
            // e.g. 18-8+6 = 16
            exchangeRate = 10 ** uint256(18 - 8 + underlyingDecimals);
        } else {
            exchangeRate = 1e18;
        }
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
        uint256 factor = 100002 * (10**13); // 0.002%
        exchangeRate = exchangeRate.mulTruncate(factor);
    }

    function exchangeRateStored() external view returns (uint) {
        return exchangeRate;
    }
}
