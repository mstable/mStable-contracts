pragma solidity 0.5.16;

import { ISavingsContractV2 } from "../../interfaces/ISavingsContract.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IBoostedSavingsVault {
    function stake(address _beneficiary, uint256 _amount) external;
}

/**
 * @title  SaveAndStake
 * @author Stability Labs Pty. Ltd.
 * @notice Simply saves an mAsset and then into the vault
 */
contract SaveAndStake {

    address mAsset;
    address save;
    address vault;

    constructor(
        address _mAsset, // constant
        address _save, // constant
        address _vault // constant
    )
        public
    {
        mAsset = _mAsset;
        save = _save;
        vault = _vault;
        IERC20(_mAsset).approve(_save, uint256(-1));
        IERC20(_save).approve(_vault, uint256(-1));
    }

    /**
     * @dev Simply saves an mAsset and then into the vault
     * @param _amount Units of mAsset to deposit to savings
     */
    function saveAndStake(uint256 _amount) external {
        IERC20(mAsset).transferFrom(msg.sender, address(this), _amount);
        uint256 credits = ISavingsContractV2(save).depositSavings(_amount);
        IBoostedSavingsVault(vault).stake(msg.sender, credits);
    }
}