// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

import { ICERC20 } from "../../peripheral/Compound/ICERC20.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { StableMath } from "../../shared/StableMath.sol";

contract MockCToken is ERC20, ICERC20 {
    using StableMath for uint256;

    uint8 public dec = 8;
    ERC20 public immutable underlyingToken;
    // underlying = cToken * exchangeRate / 1e18
    // cToken = underlying * 1e18 / exchangeRate
    // exchangeRate = underlying / cToken * 1e18
    // 1 underlying token = 100 cTokens
    // as cToken has 8 decimals, 1 underlying token with 18 decimals equals
    // 18 - 10 + 2 = 10 digit integer = 100 with 8 decimals
    uint256 public exchangeRate;

    constructor(
        string memory _name,
        string memory _symbol,
        ERC20 _underlyingToken
    ) ERC20(_name, _symbol) {
        uint8 underlyingDecimals = _underlyingToken.decimals();
        // if underlying is 18 decimals, exchange rate has 26 decimals
        exchangeRate = 10**uint256(underlyingDecimals + 8);

        underlyingToken = _underlyingToken;
    }

    function mint(uint256 mintAmount) external override returns (uint256) {
        // Pretend to inflate the cTokenExchangeRate
        // updateExchangeRate();

        // Get the bAsset bal of this cToken contract before transfer
        uint256 bAssetsBefore = underlyingToken.balanceOf(address(this));

        // Take their reserve
        underlyingToken.transferFrom(msg.sender, address(this), mintAmount);

        // Get the bAsset bal of this cToken contract after transfer
        uint256 bAssetsAfter = underlyingToken.balanceOf(address(this));
        // calculate bAsset deposit amount after any transfer fees
        uint256 bAssetsDeposited = bAssetsAfter - bAssetsBefore;

        // Credit new cTokens for the deposited bAssets
        uint256 cTokens = _convertUnderlyingToCToken(bAssetsDeposited);
        _mint(msg.sender, cTokens);
        return 0;
    }

    function redeemUnderlying(uint256 redeemAmount) external override returns (uint256) {
        // Pretend to inflate the cTokenExchangeRate
        // updateExchangeRate();

        // Burn the cToken
        uint256 cTokens = _convertUnderlyingToCToken(redeemAmount);
        _burn(msg.sender, cTokens);

        // Send them back their reserve
        underlyingToken.transfer(msg.sender, redeemAmount);
        return 0;
    }

    function balanceOfUnderlying(address owner) external view override returns (uint256) {
        // updateExchangeRate();
        uint256 cTokenBal = this.balanceOf(owner);
        return cTokenBal.mulTruncate(exchangeRate);
    }

    // Used for testing purposes to increase the value of the token
    function updateExchangeRate() public {
        uint256 factor = 100002 * (10**13); // 0.002%
        exchangeRate = exchangeRate.mulTruncate(factor);
    }

    function exchangeRateStored() external view override returns (uint256) {
        return exchangeRate;
    }

    function balanceOf(address account) public view override(ERC20, ICERC20) returns (uint256) {
        return ERC20.balanceOf(account);
    }

    /**
     * @dev Converts an underlying amount into cToken amount
     *          cTokenAmt = (underlying * 1e18) / exchangeRate
     * @param _underlying Amount of underlying to convert
     * @return amount     Equivalent amount of cTokens
     */
    function _convertUnderlyingToCToken(uint256 _underlying)
        internal
        view
        returns (uint256 amount)
    {
        amount = (_underlying * 1e18) / exchangeRate;
    }
}
