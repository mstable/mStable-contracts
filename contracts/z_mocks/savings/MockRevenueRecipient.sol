// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { IRevenueRecipient } from "../../interfaces/ISavingsManager.sol";
import { IERC20 } from "@openzeppelin/contracts-solc7/token/ERC20/IERC20.sol";

contract MockRevenueRecipient is IRevenueRecipient {


    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external {
        IERC20(_mAsset).transferFrom(msg.sender, address(this), _amount);
    }
}