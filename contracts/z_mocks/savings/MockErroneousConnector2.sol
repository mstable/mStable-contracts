pragma solidity 0.5.16;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "../../savings/peripheral/IConnector.sol";
import { StableMath, SafeMath } from "../../shared/StableMath.sol";


// 2. Returns invalid balance on checkbalance
// 3. Returns negative balance immediately after checkbalance
contract MockErroneousConnector2 is IConnector {

    using StableMath for uint256;
    using SafeMath for uint256;

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

    function poke() external {
        lastValue -= 100;
    }

    function deposit(uint256 _amount) external onlySave {
        IERC20(mUSD).transferFrom(save, address(this), _amount);
        lastValue += _amount;
    }

    function withdraw(uint256 _amount) external onlySave {
        IERC20(mUSD).transfer(save, _amount);
        lastValue -= _amount;
        lastValue -= 1;
    }

    function withdrawAll() external onlySave {
        IERC20(mUSD).transfer(save, lastValue);
        lastValue -= lastValue;
    }

    function checkBalance() external view returns (uint256) {
        return lastValue;
    }
}