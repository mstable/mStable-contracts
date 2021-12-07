// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IDisperse } from "../../interfaces/IDisperse.sol";

contract MockDisperse is IDisperse {
    function disperseTokenSimple(
        IERC20 token,
        address[] calldata recipients,
        uint256[] calldata values
    ) external override {
        for (uint256 i = 0; i < recipients.length; i++) {
            // solhint-disable-next-line reason-string
            require(token.transferFrom(msg.sender, recipients[i], values[i]));
        }
    }
}
