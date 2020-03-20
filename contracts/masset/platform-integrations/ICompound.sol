pragma solidity 0.5.16;

/**
 * @notice Compound C Token interface
 * Documentation: https://compound.finance/developers/ctokens
 */
interface ICERC20 {

    /**
     * @notice The mint function transfers an asset into the protocol, which begins accumulating
     * interest based on the current Supply Rate for the asset. The user receives a quantity of
     * cTokens equal to the underlying tokens supplied, divided by the current Exchange Rate.
     * @param mintAmount The amount of the asset to be supplied, in units of the underlying asset.
     * @return 0 on success, otherwise an Error codes
     */
    function mint(uint mintAmount) external returns (uint);

    /**
     * @notice The redeem underlying function converts cTokens into a specified quantity of the underlying
     * asset, and returns them to the user. The amount of cTokens redeemed is equal to the quantity of
     * underlying tokens received, divided by the current Exchange Rate. The amount redeemed must be less
     * than the user's Account Liquidity and the market's available liquidity.
     * @param redeemAmount The amount of underlying to be redeemed.
     * @return 0 on success, otherwise an Error codes
     */
    function redeemUnderlying(uint redeemAmount) external returns (uint);

    /**
     * @notice The user's underlying balance, representing their assets in the protocol, is equal to
     * the user's cToken balance multiplied by the Exchange Rate.
     * @param account The account to get the underlying balance of.
     * @return The amount of underlying currently owned by the account.
     */
    function balanceOfUnderlying(address owner) external returns (uint);
}
