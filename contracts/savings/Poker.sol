// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IBoostedVaultWithLockup } from "../interfaces/IBoostedVaultWithLockup.sol";

struct PokeVaultAccounts {
    // Address of the Boosted Vault
    address boostVault;
    // List of accounts to be poked
    address[] accounts;
}

/**
 * @title   Poker
 * @author  mStable
 * @notice  Pokes accounts on boosted vaults so their vault balances can be recalculated.
 * @dev     VERSION: 1.0
 *          DATE:    2021-04-17
 */
contract Poker {
    /**
     * @dev For each boosted vault, poke all the over boosted accounts.
     * @param _vaultAccounts     An array of PokeVaultAccounts structs
     */
    function poke(PokeVaultAccounts[] memory _vaultAccounts) external {
        uint256 vaultCount = _vaultAccounts.length;
        for (uint256 i = 0; i < vaultCount; i++) {
            PokeVaultAccounts memory vaultAccounts = _vaultAccounts[i];
            address boostVaultAddress = vaultAccounts.boostVault;
            require(boostVaultAddress != address(0), "blank vault address");
            IBoostedVaultWithLockup boostVault = IBoostedVaultWithLockup(boostVaultAddress);

            uint256 accountsLength = vaultAccounts.accounts.length;
            for (uint256 j = 0; j < accountsLength; j++) {
                address accountAddress = vaultAccounts.accounts[j];
                require(accountAddress != address(0), "blank address");
                boostVault.pokeBoost(accountAddress);
            }
        }
    }
}
