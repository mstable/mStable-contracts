// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { SafeMath } from "@openzeppelin/contracts-solc7/math/SafeMath.sol";

library Root {

    using SafeMath for uint256;

    /**
     * @dev Returns the square root of a given number
     * @param x Input
     * @return y Square root of Input
     */
    function sqrt(uint x) internal pure returns (uint y) {
        uint z = (x.add(1)).div(2);
        y = x;
        while (z < y) {
            y = z;
            z = (x.div(z).add(z)).div(2);
        }
    }
}