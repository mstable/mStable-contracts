pragma solidity 0.5.16;

import { CommonHelpers } from "../../shared/CommonHelpers.sol";

contract MockCommonHelpers {

    function getDecimals(address _token)
    public
    view
    returns (uint256) {
        return CommonHelpers.getDecimals(_token);
    }
}

