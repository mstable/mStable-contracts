pragma solidity 0.5.16;

interface BasicToken {
    function decimals() external view returns (uint8);
}

/**
 * @title   CommonHelpers
 * @author  Stability Labs Pty. Lte.
 */
library CommonHelpers {

    /**
     * @notice Fetch the `decimals()` from an ERC20 token
     * @dev Grabs the `decimals()` from a contract and fails if
     *      the decimal value does not live within a certain range
     * @param _token Address of the ERC20 token
     * @return uint256 Decimals of the ERC20 token
     */
    function getDecimals(address _token)
    internal
    view
    returns (uint256) {
        uint256 decimals = BasicToken(_token).decimals();
        require(decimals >= 4 && decimals <= 18, "Token must have sufficient decimal places");

        return decimals;
    }

}