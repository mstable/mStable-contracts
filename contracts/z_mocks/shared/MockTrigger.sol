pragma solidity 0.5.16;

import { ILiquidator } from "../../masset/liquidator/ILiquidator.sol";


contract MockTrigger {

    function trigger(ILiquidator _liq, address _integration) external {
        _liq.triggerLiquidation(_integration);
    }
}