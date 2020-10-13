pragma solidity 0.5.16;

import { Root } from "../../shared/Root.sol";

contract MockRoot {
    function sqrt(uint256 r) public pure returns (uint256) {
        return Root.sqrt(r);
    }
}
