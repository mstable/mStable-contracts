// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IRootChainManager {
    function depositFor(
        address userAddress,
        address rootToken,
        bytes memory data
    ) external;
}
