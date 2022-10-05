// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { ERC205 } from "../../shared/@openzeppelin-2.5/ERC205.sol";
import { InitializableERC20Detailed, IERC20 } from "../../shared/InitializableERC20Detailed.sol";
import "@openzeppelin/contracts/utils/Address.sol";

interface IERC677Receiver {
    function onTokenTransfer(address, uint256, bytes memory) external returns (bool);
}

contract MockERC677 is ERC205, InitializableERC20Detailed {
    using Address for address;
    
    event ContractFallbackCallFailed(address from, address to, uint256 value);

    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    ) external {
        InitializableERC20Detailed._initialize(_nameArg, _symbolArg, _decimals);

        _mint(_initialRecipient, _initialMint * (10**uint256(_decimals)));
    }

    function transfer(address _to, uint256 _value) public override(ERC205, IERC20) returns (bool) {
        require(super.transfer(_to, _value));
        callAfterTransfer(msg.sender, _to, _value);
        return true;
    }

    function callAfterTransfer(address _from, address _to, uint256 _value) internal {
        if (_from.isContract() && !IERC677Receiver(_from).onTokenTransfer(_from, _value, new bytes(0))) {
            emit ContractFallbackCallFailed(_from, _to, _value);
        }
    }
}
