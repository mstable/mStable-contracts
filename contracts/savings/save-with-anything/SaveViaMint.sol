pragma solidity 0.5.16;

import { IMasset } from "../../interfaces/IMasset.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { ISavingsContract } from "../../interfaces/ISavingsContract.sol";

contract SaveViaMint {

    using SafeERC20 for IERC20;

    address save;

    constructor(address _save, address _mAsset) public {
        save = _save;
        IERC20(_mAsset).safeApprove(save, uint256(-1));

    }

    function mintAndSave(address _mAsset, address _bAsset, uint _bassetAmount) external {
        IERC20(_bAsset).transferFrom(msg.sender, address(this), _bassetAmount);
        IERC20(_bAsset).safeApprove(_mAsset, _bassetAmount);
        IMasset mAsset = IMasset(_mAsset);
        uint massetsMinted = mAsset.mint(_bAsset, _bassetAmount);
        ISavingsContract(save).deposit(massetsMinted, msg.sender);
    }

}