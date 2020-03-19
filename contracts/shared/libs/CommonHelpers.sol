pragma solidity 0.5.16;


interface BasicToken {
    function decimals() external view returns (uint8);
}

/**
  * @title CommonHelpers
  * @dev Consolidation of helper methods used throughout the system
  */
library CommonHelpers {

    /**
      * @dev Enforce the successfull execution of a contracts 'decimals()' function
      * This should prove to a certain degree that the token contract is an ERC20
      * @param _token Address of the contract on which to call decimals()
      * @return uint256 Decimals of the ERC20 contract
      */
    function mustGetDecimals(address _token)
    internal
    returns (uint256) {
        (bool success, ) = _token.call(abi.encodeWithSignature("decimals()"));
        require(success, "Contract must support decimals");

        return getDecimals(_token);
    }

    /** @dev Get decimals from a pre-verified asset */
    function getDecimals(address _token)
    internal
    view
    returns (uint256) {
        uint256 decimals = BasicToken(_token).decimals();
        require(decimals > 0, "Token must decimal places");

        return decimals;
    }
}