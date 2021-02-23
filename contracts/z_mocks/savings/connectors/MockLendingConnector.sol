// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "../../../savings/peripheral/IConnector.sol";


contract MockLendingConnector is IConnector {

    address save;
    address mUSD;

    uint256 lastValue;
    uint256 lastAccrual;
    uint256 constant perSecond = 31709791983;

    constructor(
        address _save,
        address _mUSD
    ) public {
        save = _save;
        mUSD = _mUSD;
    }

    modifier onlySave() {
        require(save == msg.sender, "Only SAVE can call this");
        _;
    }

    modifier _accrueValue() {
        uint256 currentTime = block.timestamp;
        if(lastAccrual != 0){
            uint256 timeDelta = currentTime - lastAccrual;
            uint256 interest = timeDelta * perSecond;
            uint256 newValue = lastValue * interest / 1e18;
            lastValue += newValue;
        }
        lastAccrual = currentTime;
        _;
    }

    function poke() external _accrueValue {
        
    }

    function deposit(uint256 _amount) external override _accrueValue onlySave {
        IERC20(mUSD).transferFrom(save, address(this), _amount);
        lastValue += _amount;
    }

    function withdraw(uint256 _amount) external override _accrueValue onlySave {
        IERC20(mUSD).transfer(save, _amount);
        lastValue -= _amount;
    }

    function withdrawAll() external override _accrueValue onlySave {
        IERC20(mUSD).transfer(save, lastValue);
        lastValue -= lastValue;
    }

    function checkBalance() external override view returns (uint256) {
        return lastValue;
    }
}