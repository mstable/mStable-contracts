// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC4626Vault } from "../interfaces/IERC4626Vault.sol";

interface ISavingsContractV1 {
    function depositInterest(uint256 _amount) external;

    function depositSavings(uint256 _amount) external returns (uint256 creditsIssued);

    function redeem(uint256 _amount) external returns (uint256 massetReturned);

    function exchangeRate() external view returns (uint256);

    function creditBalances(address) external view returns (uint256);
}

interface ISavingsContractV2 {
    // DEPRECATED but still backwards compatible
    function redeem(uint256 _amount) external returns (uint256 massetReturned);

    function creditBalances(address) external view returns (uint256); // V1 & V2 (use balanceOf)

    // --------------------------------------------

    function depositInterest(uint256 _amount) external; // V1 & V2

    function depositSavings(uint256 _amount) external returns (uint256 creditsIssued); // V1 & V2

    function depositSavings(uint256 _amount, address _beneficiary)
        external
        returns (uint256 creditsIssued); // V2

    function redeemCredits(uint256 _amount) external returns (uint256 underlyingReturned); // V2

    function redeemUnderlying(uint256 _amount) external returns (uint256 creditsBurned); // V2

    function exchangeRate() external view returns (uint256); // V1 & V2

    function balanceOfUnderlying(address _user) external view returns (uint256 underlying); // V2

    function underlyingToCredits(uint256 _underlying) external view returns (uint256 credits); // V2

    function creditsToUnderlying(uint256 _credits) external view returns (uint256 underlying); // V2

    function underlying() external view returns (IERC20 underlyingMasset); // V2
}

interface ISavingsContractV3 {
    // DEPRECATED but still backwards compatible
    function redeem(uint256 _amount) external returns (uint256 massetReturned);

    function creditBalances(address) external view returns (uint256); // V1 & V2 (use balanceOf)

    // --------------------------------------------
    function depositInterest(uint256 _amount) external; // V1 & V2

    /** @dev see IERC4626Vault.deposit(uint256 assets, address receiver)*/
    function depositSavings(uint256 _amount) external returns (uint256 creditsIssued); // V1 & V2

    /** @dev see IERC4626Vault.deposit(uint256 assets, address receiver)*/
    function depositSavings(uint256 _amount, address _beneficiary)
        external
        returns (uint256 creditsIssued); // V2

    /** @dev see IERC4626Vault.redeem(uint256 shares,address receiver,address owner)(uint256 assets);*/
    function redeemCredits(uint256 _amount) external returns (uint256 underlyingReturned); // V2

    /** @dev see IERC4626Vault.withdraw(uint256 assets,address receiver,address owner)(uint256 assets, address receiver)*/
    function redeemUnderlying(uint256 _amount) external returns (uint256 creditsBurned); // V2

    function exchangeRate() external view returns (uint256); // V1 & V2

    function balanceOfUnderlying(address _user) external view returns (uint256 underlying); // V2

    function underlyingToCredits(uint256 _underlying) external view returns (uint256 credits); // V2

    function creditsToUnderlying(uint256 _credits) external view returns (uint256 underlying); // V2

    /** @dev see IERC4626Vault.asset()(address assetTokenAddress);*/
    function underlying() external view returns (IERC20 underlyingMasset); // V2

    // --------------------------------------------

    function redeemAndUnwrap(
        uint256 _amount,
        bool _isCreditAmt,
        uint256 _minAmountOut,
        address _output,
        address _beneficiary,
        address _router,
        bool _isBassetOut
    )
        external
        returns (
            uint256 creditsBurned,
            uint256 massetRedeemed,
            uint256 outputQuantity
        ); // V3

    function depositSavings(
        uint256 _underlying,
        address _beneficiary,
        address _referrer
    ) external returns (uint256 creditsIssued); // V3
}

interface ISavingsContractV4 is
    IERC4626Vault // V4
{
    // DEPRECATED but still backwards compatible
    function redeem(uint256 _amount) external returns (uint256 massetReturned); // V1  (use IERC4626Vault.redeem)

    function creditBalances(address) external view returns (uint256); // V1 & V2 (use balanceOf)

    // --------------------------------------------
    function depositInterest(uint256 _amount) external; // V1 & V2

    /** @dev see IERC4626Vault.deposit(uint256 assets, address receiver)*/
    function depositSavings(uint256 _amount) external returns (uint256 creditsIssued); // V1 & V2

    /** @dev see IERC4626Vault.deposit(uint256 assets, address receiver)*/
    function depositSavings(uint256 _amount, address _beneficiary)
        external
        returns (uint256 creditsIssued); // V2

    /** @dev see IERC4626Vault.redeem(uint256 shares,address receiver,address owner)(uint256 assets);*/
    function redeemCredits(uint256 _amount) external returns (uint256 underlyingReturned); // V2

    /** @dev see IERC4626Vault.withdraw(uint256 assets,address receiver,address owner)(uint256 assets, address receiver)*/
    function redeemUnderlying(uint256 _amount) external returns (uint256 creditsBurned); // V2

    function exchangeRate() external view returns (uint256); // V1 & V2

    function balanceOfUnderlying(address _user) external view returns (uint256 underlying); // V2

    function underlyingToCredits(uint256 _underlying) external view returns (uint256 credits); // V2

    function creditsToUnderlying(uint256 _credits) external view returns (uint256 underlying); // V2

    /** @dev see IERC4626Vault.asset()(address assetTokenAddress);*/
    function underlying() external view returns (IERC20 underlyingMasset); // V2

    function redeemAndUnwrap(
        uint256 _amount,
        bool _isCreditAmt,
        uint256 _minAmountOut,
        address _output,
        address _beneficiary,
        address _router,
        bool _isBassetOut
    )
        external
        returns (
            uint256 creditsBurned,
            uint256 massetRedeemed,
            uint256 outputQuantity
        ); // V3

    function depositSavings(
        uint256 _underlying,
        address _beneficiary,
        address _referrer
    ) external returns (uint256 creditsIssued); // V3

    // -------------------------------------------- V4
    function deposit(
        uint256 assets,
        address receiver,
        address referrer
    ) external returns (uint256 shares);

    function mint(
        uint256 shares,
        address receiver,
        address referrer
    ) external returns (uint256 assets);
}
