// SPDX-License-Identifier: MIT

// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { SignedSafeMath128 } from "../../shared/SignedSafeMath128.sol";

contract SignedSafeMath128Mock {
    function mul(int128 a, int128 b) public pure returns (int128) {
        return SignedSafeMath128.mul(a, b);
    }

    function div(int128 a, int128 b) public pure returns (int128) {
        return SignedSafeMath128.div(a, b);
    }

    function sub(int128 a, int128 b) public pure returns (int128) {
        return SignedSafeMath128.sub(a, b);
    }

    function add(int128 a, int128 b) public pure returns (int128) {
        return SignedSafeMath128.add(a, b);
    }
}
