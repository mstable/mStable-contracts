// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
import { ILiquidator } from "../../masset/liquidator/ILiquidator.sol";

contract MockTrigger {
    function trigger(ILiquidator _liq, address _integration) external {
        _liq.triggerLiquidation(_integration);
    }
}
