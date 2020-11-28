pragma solidity 0.5.16;

import { ISavingsContract } from "../../interfaces/ISavingsContract.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SaveViaMint {

    address save;
    address mAsset = "";

    constructor(address _save) public {
        save = _save;
    }

    function mintAndSave(address _mAsset, address _bAsset, uint _bassetAmount) external {
        IERC20(_bAsset).transferFrom(msg.sender, address(this), _bassetAmount);
        IERC20(_bAsset).approve(address(this), _bassetAmount);
        IMasset mAsset = IMasset(_mAsset);
        uint massetsMinted = mAsset.mint(_bAsset, _bassetAmount);
        ISavingsContract(save).deposit(massetsMinted, msg.sender);
    }

}