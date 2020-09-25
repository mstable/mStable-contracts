pragma solidity 0.5.16;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

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