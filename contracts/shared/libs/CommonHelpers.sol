pragma solidity ^0.5.12;


interface BasicToken {
    function decimals() external view returns (uint8);
}

/**
  * @title CommonHelpers
  * @dev Consolidation of helper methods used throughout the system
  */
library CommonHelpers {

    function addU(uint x, uint y) internal pure returns (uint z) {
        require((z = x + y) >= x, "Must not overflow");
    }

    /**
      * @dev Enforce the successfull execution of a contracts 'decimals()' function
      * This should prove to a certain degree that the token contract is an ERC20
      * @param _token Address of the contract on which to call decimals()
      * @return uint256 Decimals of the ERC20 contract
      */
    function mustGetDecimals(address _token)
    internal
    returns (uint256) {
        /* solium-disable-next-line security/no-low-level-calls */
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

    /**
      * @dev Calculate the total sum of all items in an array
      * @return uint256 total sum of basket asset weightings
      */
    function sumOfArrayValues(uint256[] memory _array)
    internal
    pure
    returns (uint256) {
        uint256 sum = 0;
        uint256 arrayLength = _array.length;
        for (uint256 i = 0; i < arrayLength; i++) {
            uint256 result = addU(sum, _array[i]);
            sum = result;
        }
        return sum;
    }
}