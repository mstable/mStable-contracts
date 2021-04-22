// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { Context } from "@openzeppelin/contracts/utils/Context.sol";

/**
 * @dev Context variant with ERC2771 support.
 */
abstract contract ERC2771Context is Context {
    address public _trustedForwarder;

    function setTrustedForwarder(address _forwarder) public virtual;

    function isTrustedForwarder(address forwarder) public view virtual returns (bool) {
        return forwarder == _trustedForwarder;
    }

    function _msgSender() internal view virtual override returns (address sender) {
        if (isTrustedForwarder(msg.sender)) {
            // The assembly code is more direct than the Solidity version using `abi.decode`.
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            return super._msgSender();
        }
    }

    function _msgData() internal view virtual override returns (bytes calldata msgData) {
        if (isTrustedForwarder(msg.sender)) {
            return msg.data[0:msg.data.length - 20];
        } else {
            return super._msgData();
        }
    }
}
