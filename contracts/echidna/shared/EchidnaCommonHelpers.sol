pragma solidity 0.5.16;

import { CommonHelpers } from "../../shared/CommonHelpers.sol";

contract EchidnaCommonHelpers {
    address test = address(0x1);

    function getDecimals(address _token)
    public
    view
    returns (uint256) {
        return CommonHelpers.getDecimals(_token);
    }
    function echidna_decimals_working() public returns (bool) {
        return (getDecimals(test) > 0);
    } 
}

