// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { GovernedMinterRole } from "./GovernedMinterRole.sol";
import { ERC20 } from "@openzeppelin/contracts-solc7/token/ERC20/ERC20.sol";
import { ERC20Burnable } from "@openzeppelin/contracts-solc7/token/ERC20/ERC20Burnable.sol";

/**
 * @title  MetaToken
 * @author Stability Labs Pty. Ltd.
 * @dev    MetaToken is an ERC20 token, with mint privileges governed by mStable
 * governors
 */
contract MetaToken is
    ERC20,
    GovernedMinterRole,
    ERC20Burnable
{

    /**
     * @dev MetaToken simply implements a detailed ERC20 token,
     * and a governed list of minters
     */
    constructor(
        address _nexus,
        address _initialRecipient
    )
        GovernedMinterRole(_nexus)
        ERC20(
            "Meta",
            "MTA"
        )
    {
        // 100m initial supply
        _mint(_initialRecipient, 100000000 * (10 ** 18));
    }

    // Forked from @openzeppelin
    /**
     * @dev See {ERC20-_mint}.
     *
     * Requirements:
     *
     * - the caller must have the {MinterRole}.
     */
    function mint(address account, uint256 amount) public onlyMinter returns (bool) {
        _mint(account, amount);
        return true;
    }
}