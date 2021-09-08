// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract MockBPT is ERC20, ERC20Burnable {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        // 100m initial supply
        _mint(msg.sender, 10000 * (10**18));
    }

    function onExitPool(address sender, uint256 amt) external {
        _burn(sender, amt);
    }
}
