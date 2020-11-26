pragma solidity 0.5.16;

/**
 * @title ISavingsContract
 */
interface ISavingsContract {

    // V1 METHODS
    function depositInterest(uint256 _amount) external;

    function depositSavings(uint256 _amount) external returns (uint256 creditsIssued);
    function redeem(uint256 _amount) external returns (uint256 massetReturned);

    function exchangeRate() external view returns (uint256);
    function creditBalances(address) external view returns (uint256);

    // V2 METHODS
    function deposit(uint256 _amount, address _beneficiary) external returns (uint256 creditsIssued);
    function redeemUnderlying(uint256 _amount) external returns (uint256 creditsBurned);
    // redeemToOrigin? Redeem amount to the tx.origin so it can be used by caller (e.g. to convert to USDT)
    function balanceOfUnderlying(address _user) external view returns (uint256 balance);
}