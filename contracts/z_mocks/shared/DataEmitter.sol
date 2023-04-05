// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;
import { Address } from "@openzeppelin/contracts/utils/Address.sol";

contract DataEmitter {
    event Data(bytes data);

    function emitCall(address target, bytes memory data) public returns (bytes memory result) {
        result = Address.functionCall(target, data);

        emit Data(result);
    }

    function emitStaticCall(
        address target,
        bytes memory data
    ) public returns (bytes memory result) {
        result = Address.functionStaticCall(target, data);

        emit Data(result);
    }
}
