pragma solidity ^0.5.12;

import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title StableMath
 * @author Stability Labs Pty. Ltd.
 * @dev Accesses the Stable Math library using generic system wide variables for managing precision
 * Derives from OpenZeppelin's SafeMath lib
 */
library StableMath {

    using SafeMath for uint256;

    /** @dev Scaling units for use in specific calculations */
    uint256 private constant fullScale = 1e18;
    uint256 private constant percentScale = 1e16; // 1% max weight == 1e16... 100% == 1e18... 50% == 5e17

    // (1 bAsset unit * bAsset.ratio) / ratioScale == 1 mAsset unit
    // Reasoning: Takes into account token decimals, and difference in base unit (i.e. grams to Troy oz for gold)
    uint256 private constant ratioScale = 1e8;

    /** @dev Getters */
    function getScale() internal pure returns (uint256) {
        return fullScale;
    }
    function getPercent() internal pure returns (uint256) {
        return percentScale;
    }
    function getRatio() internal pure returns (uint256) {
        return ratioScale;
    }

    /********************************
              UINT64 FUNCS
    ********************************/

    /** @dev Returns the addition of two unsigned integers, reverting on overflow. */
    function add(uint64 a, uint64 b) internal pure returns (uint256 c) {
        c = a + b;
        require(c >= a, "StableMath: addition overflow");
    }

    /** @dev Returns the subtraction of two unsigned integers, reverting on overflow */
    function sub(uint64 a, uint64 b) internal pure returns (uint64 c) {
        require(b <= a, "StableMath: subtraction overflow");
        c = a - b;
    }

    /** @dev Returns the multiplication of two unsigned integers, reverting on overflow. */
    function mul(uint64 a, uint64 b) internal pure returns (uint256 c) {
        if (a == 0) {
            return 0;
        }
        c = a * b;
        require(c / a == b, "StableMath: multiplication overflow");
    }

    /** @dev Returns the integer division of two unsigned integers. Reverts on
     * division by zero. The result is rounded towards zero. */
    function div(uint64 a, uint64 b) internal pure returns (uint256 c) {
        require(b > 0, "StableMath: division by zero");
        c = a / b;
    }

    /********************************
              UINT256 FUNCS
    ********************************/

    /** @dev Scaled a given integer to the power of the full scale. */
    function scale(uint256 a) internal pure returns (uint256 b) {
        return a.mul(fullScale);
    }

    /** @dev Multiplies two numbers and truncates */
    function mulTruncate(uint256 a, uint256 b, uint256 _scale) internal pure returns (uint256 c) {
        uint256 d = a.mul(b);
        c = d.div(_scale);
    }

    /** @dev Multiplies two numbers and truncates using standard full scale */
    function mulTruncate(uint256 a, uint256 b) internal pure returns (uint256 c){
        return mulTruncate(a, b, fullScale);
    }

    /** @dev Multiplies two numbers and truncates to ceil */
    function mulTruncateCeil(uint256 a, uint256 b) internal pure returns (uint256 c){
        uint256 scaled = a.mul(b);
        uint256 ceil = scaled.add(fullScale.sub(1));
        c = ceil.div(fullScale);
    }


    /** @dev Precisely divides two numbers, first by expanding */
    function divPrecisely(uint256 a, uint256 b) internal pure returns (uint256 c) {
        uint256 d = a.mul(fullScale);
        c = d.div(b);
    }

    /** @dev Returns minimum of two numbers */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? b : a;
    }

    /** @dev Returns maximum of two numbers */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /** @dev Clamps a value to an upper bound */
    function clamp(uint a, uint upperBound) internal pure returns (uint b) {
        return a > upperBound ? upperBound : a;
    }

    /********************************
              RATIO FUNCS
    ********************************/

    /** @notice Token Ratios are used when converting between units of Basset, Masset and Meta
     * It consists of 10^(18-tokenDecimals) * measurementMultiple(where 1:1 == 1e8) */

    /** @dev Multiplies and truncates a token ratio, essentially flooring */
    function mulRatioTruncate(uint256 a, uint256 ratio) internal pure returns (uint256 c){
        return mulTruncate(a, ratio, ratioScale);
    }

    /** @dev Multiplies and truncates a token ratio, rounding up */
    function mulRatioTruncateCeil(uint256 a, uint256 ratio) internal pure returns (uint256 c){
        uint256 scaled = a.mul(ratio);
        uint256 ceil = scaled.add(ratioScale.sub(1));
        c = ceil.div(ratioScale);
    }

    /** @dev Divides a value by a given ratio, by first extrapolating */
    function divRatioPrecisely(uint256 a, uint256 ratio) internal pure returns (uint256 c){
        uint256 d = a.mul(ratioScale);
        c = d.div(ratio);
    }

}
