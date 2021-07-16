// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IRevenueRecipient } from "../../interfaces/IRevenueRecipient.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockRevenueRecipient is IRevenueRecipient {
    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external override {
        IERC20(_mAsset).transferFrom(msg.sender, address(this), _amount);
    }

    function depositToPool(address[] calldata _mAssets, uint256[] calldata _percentages)
        external
        override
    {}
}
