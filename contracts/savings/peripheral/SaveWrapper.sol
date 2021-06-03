// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { ISavingsContractV2 } from "../../interfaces/ISavingsContract.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IFeederPool } from "../../interfaces/IFeederPool.sol";
import { IBoostedVaultWithLockup } from "../../interfaces/IBoostedVaultWithLockup.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IUniswapV2Router02 } from "../../peripheral/Uniswap/IUniswapV2Router02.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";

// FLOWS
// 0 - mAsset -> Savings Vault
// 1 - bAsset -> Save/Savings Vault via Mint
// 2 - fAsset -> Save/Savings Vault via Feeder Pool
// 3 - ETH    -> Save/Savings Vault via Uniswap
contract SaveWrapper is Ownable {
    using SafeERC20 for IERC20;

    /**
     * @dev 0. Simply saves an mAsset and then into the vault
     * @param _mAsset   mAsset address
     * @param _save     Save address
     * @param _vault    Boosted Savings Vault address
     * @param _amount   Units of mAsset to deposit to savings
     */
    function saveAndStake(
        address _mAsset,
        address _save,
        address _vault,
        uint256 _amount
    ) external {
        require(_mAsset != address(0), "Invalid mAsset");
        require(_save != address(0), "Invalid save");
        require(_vault != address(0), "Invalid vault");

        // 1. Get the input mAsset
        IERC20(_mAsset).safeTransferFrom(msg.sender, address(this), _amount);

        // 2. Mint imAsset and stake in vault
        _saveAndStake(_save, _vault, _amount, true);
    }

    /**
     * @dev 1. Mints an mAsset and then deposits to Save/Savings Vault
     * @param _mAsset       mAsset address
     * @param _bAsset       bAsset address
     * @param _save         Save address
     * @param _vault        Boosted Savings Vault address
     * @param _amount       Amount of bAsset to mint with
     * @param _minOut       Min amount of mAsset to get back
     * @param _stake        Add the imAsset to the Boosted Savings Vault?
     */
    function saveViaMint(
        address _mAsset,
        address _save,
        address _vault,
        address _bAsset,
        uint256 _amount,
        uint256 _minOut,
        bool _stake
    ) external {
        require(_mAsset != address(0), "Invalid mAsset");
        require(_save != address(0), "Invalid save");
        require(_vault != address(0), "Invalid vault");
        require(_bAsset != address(0), "Invalid bAsset");

        // 1. Get the input bAsset
        IERC20(_bAsset).safeTransferFrom(msg.sender, address(this), _amount);

        // 2. Mint
        uint256 massetsMinted = IMasset(_mAsset).mint(_bAsset, _amount, _minOut, address(this));

        // 3. Mint imAsset and optionally stake in vault
        _saveAndStake(_save, _vault, massetsMinted, _stake);
    }

    /**
     * @dev 2. Swaps fAsset for mAsset and then deposits to Save/Savings Vault
     * @param _mAsset             mAsset address
     * @param _save               Save address
     * @param _vault              Boosted Savings Vault address
     * @param _feeder             Feeder Pool address
     * @param _fAsset             fAsset address
     * @param _fAssetQuantity     Quantity of fAsset sent
     * @param _minOutputQuantity  Min amount of mAsset to be swapped and deposited
     * @param _stake              Deposit the imAsset in the Savings Vault?
     */
    function saveViaSwap(
        address _mAsset,
        address _save,
        address _vault,
        address _feeder,
        address _fAsset,
        uint256 _fAssetQuantity,
        uint256 _minOutputQuantity,
        bool _stake
    ) external {
        require(_feeder != address(0), "Invalid feeder");
        require(_mAsset != address(0), "Invalid mAsset");
        require(_save != address(0), "Invalid save");
        require(_vault != address(0), "Invalid vault");
        require(_fAsset != address(0), "Invalid input");

        // 0. Transfer the fAsset here
        IERC20(_fAsset).safeTransferFrom(msg.sender, address(this), _fAssetQuantity);

        // 1. Swap the fAsset for mAsset with the feeder pool
        uint256 mAssetQuantity =
            IFeederPool(_feeder).swap(
                _fAsset,
                _mAsset,
                _fAssetQuantity,
                _minOutputQuantity,
                address(this)
            );

        // 2. Deposit the mAsset into Save and optionally stake in the vault
        _saveAndStake(_save, _vault, mAssetQuantity, _stake);
    }

    /**
     * @dev 3. Buys a bAsset on Uniswap with ETH, then mints imAsset via mAsset,
     *         optionally staking in the Boosted Savings Vault
     * @param _mAsset         mAsset address
     * @param _save           Save address
     * @param _vault          Boosted vault address
     * @param _uniswap        Uniswap router address
     * @param _amountOutMin   Min uniswap output in bAsset units
     * @param _path           Sell path on Uniswap (e.g. [WETH, DAI])
     * @param _minOutMStable  Min amount of mAsset to receive
     * @param _stake          Add the imAsset to the Savings Vault?
     */
    function saveViaUniswapETH(
        address _mAsset,
        address _save,
        address _vault,
        address _uniswap,
        uint256 _amountOutMin,
        address[] calldata _path,
        uint256 _minOutMStable,
        bool _stake
    ) external payable {
        require(_mAsset != address(0), "Invalid mAsset");
        require(_save != address(0), "Invalid save");
        require(_vault != address(0), "Invalid vault");
        require(_uniswap != address(0), "Invalid uniswap");

        // 1. Get the bAsset
        uint256[] memory amounts =
            IUniswapV2Router02(_uniswap).swapExactETHForTokens{ value: msg.value }(
                _amountOutMin,
                _path,
                address(this),
                block.timestamp + 1000
            );

        // 2. Purchase mAsset
        uint256 massetsMinted =
            IMasset(_mAsset).mint(
                _path[_path.length - 1],
                amounts[amounts.length - 1],
                _minOutMStable,
                address(this)
            );

        // 3. Mint imAsset and optionally stake in vault
        _saveAndStake(_save, _vault, massetsMinted, _stake);
    }

    /**
     * @dev Gets estimated mAsset output from a WETH > bAsset > mAsset trade
     * @param _mAsset       mAsset address
     * @param _uniswap      Uniswap router address
     * @param _ethAmount    ETH amount to sell
     * @param _path         Sell path on Uniswap (e.g. [WETH, DAI])
     */
    function estimate_saveViaUniswapETH(
        address _mAsset,
        address _uniswap,
        uint256 _ethAmount,
        address[] calldata _path
    ) external view returns (uint256 out) {
        require(_mAsset != address(0), "Invalid mAsset");
        require(_uniswap != address(0), "Invalid uniswap");

        uint256 estimatedBasset = _getAmountOut(_uniswap, _ethAmount, _path);
        return IMasset(_mAsset).getMintOutput(_path[_path.length - 1], estimatedBasset);
    }

    /** @dev Internal func to deposit into Save and optionally stake in the vault
     * @param _save       Save address
     * @param _vault      Boosted vault address
     * @param _amount     Amount of mAsset to deposit
     * @param _stake          Add the imAsset to the Savings Vault?
     */
    function _saveAndStake(
        address _save,
        address _vault,
        uint256 _amount,
        bool _stake
    ) internal {
        if (_stake) {
            uint256 credits = ISavingsContractV2(_save).depositSavings(_amount, address(this));
            IBoostedVaultWithLockup(_vault).stake(msg.sender, credits);
        } else {
            ISavingsContractV2(_save).depositSavings(_amount, msg.sender);
        }
    }

    /** @dev Internal func to get estimated Uniswap output from WETH to token trade */
    function _getAmountOut(
        address _uniswap,
        uint256 _amountIn,
        address[] memory _path
    ) internal view returns (uint256) {
        uint256[] memory amountsOut = IUniswapV2Router02(_uniswap).getAmountsOut(_amountIn, _path);
        return amountsOut[amountsOut.length - 1];
    }

    /**
     * @dev Approve mAsset and bAssets, Feeder Pools and fAssets, and Save/vault
     */
    function approve(
        address _mAsset,
        address[] calldata _bAssets,
        address[] calldata _fPools,
        address[] calldata _fAssets,
        address _save,
        address _vault
    ) external onlyOwner {
        _approve(_mAsset, _save);
        _approve(_save, _vault);
        _approve(_bAssets, _mAsset);

        require(_fPools.length == _fAssets.length, "Mismatching fPools/fAssets");
        for (uint256 i = 0; i < _fPools.length; i++) {
            _approve(_fAssets[i], _fPools[i]);
        }
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
