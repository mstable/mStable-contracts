// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface ITransferHook {
    function onTransfer(
        address from,
        address to,
        uint256 amount
    ) external;
}
