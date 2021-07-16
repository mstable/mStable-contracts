// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { ISavingsContractV2 } from "../../interfaces/ISavingsContract.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IFeederPool } from "../../interfaces/IFeederPool.sol";
import { IBoostedVaultWithLockup } from "../../interfaces/IBoostedVaultWithLockup.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// FLOWS
// 0 - fAsset/mAsset/mpAsset    -> FeederPool BoostedVault
// 1 - fAssets/mAssets/mpAssets -> FeederPool BoostedVault
contract FeederWrapper is Ownable {
    using SafeERC20 for IERC20;

    /**
     * @dev 0. fAsset/mAsset/mpAsset -> FeederPool BoostedVault
     * @param  _feeder             FeederPool address
     * @param  _vault              BoostedVault address (with stakingToken of `_feeder`)
     * @param  _input              Input address; fAsset, mAsset or mpAsset
     * @param  _inputQuantity      Quantity of input sent
     * @param  _minOutputQuantity  Min amount of fpToken to be minted and staked
     */
    function mintAndStake(
        address _feeder,
        address _vault,
        address _input,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity
    ) external {
        // 0. Transfer the asset here
        IERC20(_input).safeTransferFrom(msg.sender, address(this), _inputQuantity);

        // 1. Mint the fpToken and transfer here
        uint256 fpTokenAmt = IFeederPool(_feeder).mint(
            _input,
            _inputQuantity,
            _minOutputQuantity,
            address(this)
        );

        // 2. Stake the fpToken in the BoostedVault on behalf of sender
        IBoostedVaultWithLockup(_vault).stake(msg.sender, fpTokenAmt);
    }

    /**
     * @dev 1. fAssets/mAssets/mpAssets -> FeederPool BoostedVault
     * @param _feeder             FeederPool address
     * @param _vault              BoostedVault address (with stakingToken of `_feeder`)
     * @param _inputs             Input addresses; fAsset, mAsset or mpAsset
     * @param _inputQuantities    Quantity of input sent
     * @param _minOutputQuantity  Min amount of fpToken to be minted and staked
     */
    function mintMultiAndStake(
        address _feeder,
        address _vault,
        address[] calldata _inputs,
        uint256[] calldata _inputQuantities,
        uint256 _minOutputQuantity
    ) external {
        require(_inputs.length == _inputQuantities.length, "Mismatching inputs");

        // 0. Transfer the assets here
        for (uint256 i = 0; i < _inputs.length; i++) {
            IERC20(_inputs[i]).safeTransferFrom(msg.sender, address(this), _inputQuantities[i]);
        }

        // 1. Mint the fpToken and transfer here
        uint256 fpTokenAmt = IFeederPool(_feeder).mintMulti(
            _inputs,
            _inputQuantities,
            _minOutputQuantity,
            address(this)
        );

        // 2. Stake the fpToken in the BoostedVault on behalf of sender
        IBoostedVaultWithLockup(_vault).stake(msg.sender, fpTokenAmt);
    }

    /**
     * @dev Approve vault and multiple assets
     */
    function approve(
        address _feeder,
        address _vault,
        address[] calldata _assets
    ) external onlyOwner {
        _approve(_feeder, _vault);
        _approve(_assets, _feeder);
    }

    /**
     * @dev Approve one token/spender
     */
    function approve(address _token, address _spender) external onlyOwner {
        _approve(_token, _spender);
    }

    /**
     * @dev Approve multiple tokens/one spender
     */
    function approve(address[] calldata _tokens, address _spender) external onlyOwner {
        _approve(_tokens, _spender);
    }

    function _approve(address _token, address _spender) internal {
        require(_spender != address(0), "Invalid spender");
        require(_token != address(0), "Invalid token");
        IERC20(_token).safeApprove(_spender, 2**256 - 1);
    }

    function _approve(address[] calldata _tokens, address _spender) internal {
        require(_spender != address(0), "Invalid spender");
        for (uint256 i = 0; i < _tokens.length; i++) {
            require(_tokens[i] != address(0), "Invalid token");
            IERC20(_tokens[i]).safeApprove(_spender, 2**256 - 1);
        }
    }
}
