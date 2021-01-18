pragma solidity 0.5.16;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "../../savings/peripheral/IConnector.sol";
import { StableMath, SafeMath } from "../../shared/StableMath.sol";


// Use this as a template for any volatile vault implementations, to ensure
// connector invariant is held
contract MockVaultConnector is IConnector {

    using StableMath for uint256;
    using SafeMath for uint256;

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
            uint256 timeDelta = currentTime.sub(lastAccrual);
            uint256 interest = timeDelta.mul(perSecond);
            uint256 newValue = realB.mulTruncate(interest);
            realB += newValue;
        }
        lastAccrual = currentTime;
    }

    function poke() external _accrueValue {

    }

    function deposit(uint256 _amount) external _accrueValue onlySave {
        // Mimic the expected external balance here so we can track
        // the expected resulting balance following the deposit
        uint256 checkedB = _checkBalanceExt();
        trackedB = checkedB.add(_amount);

        IERC20(mUSD).transferFrom(save, address(this), _amount);
        realB += _amount.mul(995).div(1000);
    }

    function withdraw(uint256 _amount) external _accrueValue onlySave {
        uint256 checkedB = _checkBalanceExt();
        trackedB = checkedB.sub(_amount);

        IERC20(mUSD).transfer(save, _amount);
        realB -= _amount.mul(1005).div(1000);
    }

    function withdrawAll() external _accrueValue onlySave {
        trackedB = 0;

        IERC20(mUSD).transfer(save, realB);
        realB -= realB;
    }

    function checkBalance() external view returns (uint256) {
        return _checkBalanceExt();
    }

    // a call to checkBalance followed by a deposit/withdraw then another checkbalance
    // will always yield a sideways or increase
    function _checkBalanceExt() internal view returns (uint256) {
        return trackedB > realB ? trackedB : realB;
    }
}