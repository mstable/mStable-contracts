pragma solidity 0.5.16;

import { IMasset } from "../../interfaces/IMasset.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISavingsContract } from "../../interfaces/ISavingsContract.sol";

contract SaveViaMint {

    address save;

    constructor(address _save, address _mAsset) public {
        save = _save;
        IERC20(_mAsset).approve(save, uint256(-1));
    }

    function mintAndSave(address _mAsset, address _bAsset, uint _bassetAmount) external {
        IERC20(_bAsset).transferFrom(msg.sender, address(this), _bassetAmount);
        IMasset mAsset = IMasset(_mAsset);
        uint massetsMinted = mAsset.mint(_bAsset, _bassetAmount);
        ISavingsContract(save).deposit(massetsMinted, msg.sender);
    }

}