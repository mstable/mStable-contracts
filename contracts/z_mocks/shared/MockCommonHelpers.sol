// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { CommonHelpers } from "../../shared/CommonHelpers.sol";

contract MockCommonHelpers {

    function getDecimals(address _token)
    public
    view
    returns (uint256) {
        return CommonHelpers.getDecimals(_token);
    }
}

