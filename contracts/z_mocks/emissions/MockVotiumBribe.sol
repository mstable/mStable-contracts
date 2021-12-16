// SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IVotiumBribe } from "../../interfaces/IVotiumBribe.sol";

contract MockVotiumBribe is IVotiumBribe {
    using SafeERC20 for IERC20;

    address public feeAddress = 0xe39b8617D571CEe5e75e1EC6B2bb40DdC8CF6Fa3; // Votium multisig
    event Bribed(address _token, uint256 _amount, bytes32 indexed _proposal, uint256 _choiceIndex);

    function depositBribe(
        address _token,
        uint256 _amount,
        bytes32 _proposal,
        uint256 _choiceIndex
    ) external override {
        uint256 fee = 0;
        uint256 bribeTotal = _amount - fee;
        // Sends the fee to votium multisig
        IERC20(_token).safeTransferFrom(msg.sender, feeAddress, fee);
        // if distributor contract is not set, store in this contract until ready
        IERC20(_token).safeTransferFrom(msg.sender, address(this), bribeTotal);

        emit Bribed(_token, bribeTotal, _proposal, _choiceIndex);
    }
}
