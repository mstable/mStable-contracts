// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IAsset {
    // solhint-disable-previous-line no-empty-blocks
}

interface IBVault {
    function exitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        ExitPoolRequest memory request
    ) external;

    struct ExitPoolRequest {
        IAsset[] assets;
        uint256[] minAmountsOut;
        bytes userData;
        bool toInternalBalance;
    }
}
