pragma solidity 0.5.16; 

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

library Root {

    using SafeMath for uint256;

    function sqrt(uint x) internal pure returns (uint y) {
        uint z = (x.add(1)).div(2);
        y = x;
        while (z < y) {
            y = z;
            z = (x.div(z).add(z)).div(2);
        }
    }
    //   function sqrt (uint256 x) external pure returns (uint256) {
    //     if (x == 0) return 0;
    //     else {
    //         uint256 xx = x;
    //         uint256 r = 1;
    //         if (xx >= 0x100000000000000000000000000000000) { xx >>= 128; r <<= 64; }
    //         if (xx >= 0x10000000000000000) { xx >>= 64; r <<= 32; }
    //         if (xx >= 0x100000000) { xx >>= 32; r <<= 16; }
    //         if (xx >= 0x10000) { xx >>= 16; r <<= 8; }
    //         if (xx >= 0x100) { xx >>= 8; r <<= 4; }
    //         if (xx >= 0x10) { xx >>= 4; r <<= 2; }
    //         if (xx >= 0x8) { r <<= 1; }
    //         r = (r + x / r) >> 1;
    //         r = (r + x / r) >> 1;
    //         r = (r + x / r) >> 1;
    //         r = (r + x / r) >> 1;
    //         r = (r + x / r) >> 1;
    //         r = (r + x / r) >> 1;
    //         r = (r + x / r) >> 1; // Seven iterations should be enough
    //         uint256 r1 = x / r;
    //         return r < r1 ? r : r1;
    //     }
    // }
}