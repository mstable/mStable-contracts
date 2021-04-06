// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { ISavingsContractV2 } from "../../interfaces/ISavingsContract.sol";
import { IMasset } from "../../interfaces/IMasset.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { IUniswapV2Router02 } from "../../interfaces/IUniswapV2Router02.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";

interface IBoostedSavingsVault {
    function stake(address _beneficiary, uint256 _amount) external;
}

// 3 FLOWS
// 0 - SAVE
// 1 - MINT AND SAVE
// 2 - BUY AND SAVE (ETH via Uni)
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
        IERC20(_mAsset).transferFrom(msg.sender, address(this), _amount);

        // 2. Mint imAsset and stake in vault
        _saveAndStake(_save, _vault, _amount, true);
    }

    /**
     * @dev 1. Mints an mAsset and then deposits to SAVE
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
        IERC20(_bAsset).transferFrom(msg.sender, address(this), _amount);

        // 2. Mint
        uint256 massetsMinted = IMasset(_mAsset).mint(_bAsset, _amount, _minOut, address(this));

        // 3. Mint imAsset and optionally stake in vault
        _saveAndStake(_save, _vault, massetsMinted, _stake);
    }

    /**
     * @dev 2. Buys a bAsset on Uniswap with ETH, then mints imAsset via mAsset,
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
            IBoostedSavingsVault(_vault).stake(msg.sender, credits);
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
     * @dev Approve mAsset, Save and multiple bAssets
     */
    function approve(
        address _mAsset,
        address _save,
        address _vault,
        address[] calldata _bAssets
    ) external onlyOwner {
        _approve(_mAsset, _save);
        _approve(_save, _vault);
        _approve(_bAssets, _mAsset);
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
