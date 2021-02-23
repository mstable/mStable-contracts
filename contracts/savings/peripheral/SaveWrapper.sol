// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { ISavingsContractV2 } from "../../interfaces/ISavingsContract.sol";
import { IMasset } from "../../interfaces/IMasset.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IUniswapV2Router02 } from "../../interfaces/IUniswapV2Router02.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";


interface IBoostedSavingsVault {
    function stake(address _beneficiary, uint256 _amount) external;
}

// 3 FLOWS
// 0 - SAVE
// 1 - MINT AND SAVE
// 2 - BUY AND SAVE (ETH via Uni)
contract SaveWrapper {

    using SafeERC20 for IERC20;

    // Constants - add to bytecode during deployment
    address public immutable save;
    address public immutable vault;
    address public immutable mAsset;

    IUniswapV2Router02 public immutable uniswap;

    constructor(
        address _save,
        address _vault,
        address _mAsset,
        address[] memory _bAssets,
        address _uniswapAddress
    ) {
        require(_save != address(0), "Invalid save address");
        save = _save;
        require(_vault != address(0), "Invalid vault address");
        vault = _vault;
        require(_mAsset != address(0), "Invalid mAsset address");
        mAsset = _mAsset;
        require(_uniswapAddress != address(0), "Invalid uniswap address");
        uniswap = IUniswapV2Router02(_uniswapAddress);

        IERC20(_mAsset).safeApprove(_save, 2**256 - 1);
        IERC20(_save).approve(_vault, 2**256 - 1);
        for(uint256 i = 0; i < _bAssets.length; i++ ) {
            IERC20(_bAssets[i]).safeApprove(_mAsset, 2**256 - 1);
        }
    }


    /**
     * @dev 0. Simply saves an mAsset and then into the vault
     * @param _amount Units of mAsset to deposit to savings
     */
    function saveAndStake(uint256 _amount) external {
        IERC20(mAsset).transferFrom(msg.sender, address(this), _amount);
        _saveAndStake(_amount, true);
    }

    /**
     * @dev 1. Mints an mAsset and then deposits to SAVE
     * @param _bAsset       bAsset address
     * @param _amt          Amount of bAsset to mint with
     * @param _minOut       Min amount of mAsset to get back
     * @param _stake        Add the imUSD to the Savings Vault?
     */
    function saveViaMint(address _bAsset, uint256 _amt, uint256 _minOut, bool _stake) external {
        // 1. Get the input bAsset
        IERC20(_bAsset).transferFrom(msg.sender, address(this), _amt);
        // 2. Mint
        IMasset mAsset_ = IMasset(mAsset);
        uint256 massetsMinted = mAsset_.mint(_bAsset, _amt, _minOut, address(this));
        // 3. Mint imUSD and optionally stake in vault
        _saveAndStake(massetsMinted, _stake);
    }


    /**
     * @dev 2. Buys a bAsset on Uniswap with ETH then mUSD on Curve
     * @param _amountOutMin  Min uniswap output in bAsset units
     * @param _path          Sell path on Uniswap (e.g. [WETH, DAI])
     * @param _minOutMStable Min amount of mUSD to receive
     * @param _stake         Add the imUSD to the Savings Vault?
     */
    function saveViaUniswapETH(
        uint256 _amountOutMin,
        address[] calldata _path,
        uint256 _minOutMStable,
        bool _stake
    ) external payable {
        // 1. Get the bAsset
        uint[] memory amounts = uniswap.swapExactETHForTokens{value: msg.value}(
            _amountOutMin,
            _path,
            address(this),
            block.timestamp + 1000
        );
        // 2. Purchase mUSD
        uint256 massetsMinted = IMasset(mAsset).mint(_path[_path.length-1], amounts[amounts.length-1], _minOutMStable, address(this));
        // 3. Mint imUSD and optionally stake in vault
        _saveAndStake(massetsMinted, _stake);
    }

    /**
     * @dev Gets estimated mAsset output from a WETH > bAsset > mAsset trade
     */
    function estimate_saveViaUniswapETH(
        uint256 _ethAmount,
        address[] calldata _path,
        int128 _curvePosition
    )
        external
        view
        returns (uint256 out)
    {
        uint256 estimatedBasset = _getAmountOut(_ethAmount, _path);
        return IMasset(mAsset).getMintOutput(_path[_path.length-1], estimatedBasset);
    }

    /** @dev Internal func to deposit into SAVE and optionally stake in the vault */
    function _saveAndStake(
        uint256 _amount,
        bool _stake
    ) internal {
        if(_stake){
            uint256 credits = ISavingsContractV2(save).depositSavings(_amount, address(this));
            IBoostedSavingsVault(vault).stake(msg.sender, credits);
        } else {
            ISavingsContractV2(save).depositSavings(_amount, msg.sender);
        }
    }

    /** @dev Internal func to get esimtated Uniswap output from WETH to token trade */
    function _getAmountOut(uint256 _amountIn, address[] memory _path) internal view returns (uint256) {
        uint256[] memory amountsOut = uniswap.getAmountsOut(_amountIn, _path);
        return amountsOut[amountsOut.length - 1];
    }
}