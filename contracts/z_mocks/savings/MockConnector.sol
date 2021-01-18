pragma solidity 0.5.16;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "../../savings/peripheral/IConnector.sol";
import { StableMath, SafeMath } from "../../shared/StableMath.sol";


contract MockConnector is IConnector {

    using StableMath for uint256;
    using SafeMath for uint256;

    address save;
    address mUSD;
    uint256 deposited;

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

    function deposit(uint256 _amount) external onlySave {
        IERC20(mUSD).transferFrom(save, address(this), _amount);
        deposited = deposited.add(_amount);
    }

    function withdraw(uint256 _amount) external onlySave {
        IERC20(mUSD).transfer(save, _amount);
        deposited = deposited.sub(_amount);
    }

    function withdrawAll() external onlySave {
        IERC20(mUSD).transfer(save, deposited);
        deposited = 0;
    }

    function checkBalance() external view returns (uint256) {
        return deposited;
    }
}