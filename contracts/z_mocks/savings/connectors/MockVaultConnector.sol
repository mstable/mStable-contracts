// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "../../../savings/peripheral/IConnector.sol";


// Use this as a template for any volatile vault implementations, to ensure
// connector invariant is held
contract MockVaultConnector is IConnector {

    address save;
    address mUSD;

    uint256 trackedB;
    uint256 realB;
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

    // realBalance
    // trackedBalance

    // step 1: deposit 100
    //  - log trackedB amount
    // step 2: check Balance
    //  - get real balance
    //  - trackedB > realB ? trackedB : realB
    // step 3: realB goes to 100.1
    // step 4: withdraw 10
    //  - checkBalance must be >= 90.1 afterwards
    //  - trackedB = 90.1
    //  - trackedB > realB ? trackedB : realB
    // stpe 5: withdraw 10
    //  - checkedBalance must be >= 80.1 after
    //  - trackedB = 80.1

    modifier _accrueValue() {
        _;
        uint256 currentTime = block.timestamp;
        if(lastAccrual != 0){
            uint256 timeDelta = currentTime - lastAccrual;
            uint256 interest = timeDelta * perSecond;
            uint256 newValue = realB * interest / 1e18;
            realB += newValue;
        }
        lastAccrual = currentTime;
    }

    function poke() external _accrueValue {

    }

    function deposit(uint256 _amount) external override _accrueValue onlySave {
        // Mimic the expected external override balance here so we can track
        // the expected resulting balance following the deposit
        uint256 checkedB = _checkBalanceExt();
        trackedB = checkedB + _amount;

        IERC20(mUSD).transferFrom(save, address(this), _amount);
        realB += (_amount * 995) / 1000;
    }

    function withdraw(uint256 _amount) external override _accrueValue onlySave {
        uint256 checkedB = _checkBalanceExt();
        trackedB = checkedB - _amount;

        IERC20(mUSD).transfer(save, _amount);
        realB -= (_amount * 1005) / 1000;
    }

    function withdrawAll() external override _accrueValue onlySave {
        trackedB = 0;

        IERC20(mUSD).transfer(save, realB);
        realB -= realB;
    }

    function checkBalance() external override view returns (uint256) {
        return _checkBalanceExt();
    }

    // a call to checkBalance followed by a deposit/withdraw then another checkbalance
    // will always yield a sideways or increase
    function _checkBalanceExt() internal view returns (uint256) {
        return trackedB > realB ? trackedB : realB;
    }
}