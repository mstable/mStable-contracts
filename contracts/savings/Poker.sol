// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

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
    function poker(PokeVaultAccounts[] calldata _vaultAccounts) external {
        uint vaultCount = _vaultAccounts.length;
        for(uint i = 0; i < vaultCount; i++) {
            IBoostedVaultWithLockup boostVault = IBoostedVaultWithLockup(_vaultAccounts[i].boostVault);

            uint accountsLength = _vaultAccounts[i].accounts.length;
            for(uint j = 0; i < accountsLength; j++) {
                boostVault.pokeBoost(_vaultAccounts[i].accounts[j]);
            }
        }
    }
}