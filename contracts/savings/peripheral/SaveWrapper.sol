pragma solidity 0.5.16;

import { ISavingsContractV2 } from "../../interfaces/ISavingsContract.sol";
import { IMasset } from "../../interfaces/IMasset.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IUniswapV2Router02 } from "../../masset/liquidator/IUniswapV2Router02.sol";
import { ICurveMetaPool } from "../../masset/liquidator/ICurveMetaPool.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";


interface IBoostedSavingsVault {
    function stake(address _beneficiary, uint256 _amount) external;
}

// 4 FLOWS
// 0 - SAVE
// 1 - MINT AND SAVE
// 2 - BUY AND SAVE (Curve)
// 3 - BUY AND SAVE (ETH via Uni)
contract SaveWrapper {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Constants - add to bytecode during deployment
    address save;
    address vault;
    address mAsset;

    IUniswapV2Router02 uniswap;
    ICurveMetaPool curve;

    constructor(
        address _save,
        address _vault,
        address _mAsset,
        address[] memory _bAssets,
        address _uniswapAddress,
        address _curveAddress,
        address[] memory _curveAssets
    ) public {
        require(_save != address(0), "Invalid save address");
        save = _save;
        require(_vault != address(0), "Invalid vault address");
        vault = _vault;
        require(_mAsset != address(0), "Invalid mAsset address");
        mAsset = _mAsset;
        require(_uniswapAddress != address(0), "Invalid uniswap address");
        uniswap = IUniswapV2Router02(_uniswapAddress);
        require(_curveAddress != address(0), "Invalid curve address");
        curve = ICurveMetaPool(_curveAddress);

        IERC20(_mAsset).safeApprove(save, uint256(-1));
        IERC20(_save).approve(_vault, uint256(-1));
        for(uint256 i = 0; i < _curveAssets.length; i++ ) {
            IERC20(_curveAssets[i]).safeApprove(address(curve), uint256(-1));
        }
        for(uint256 i = 0; i < _bAssets.length; i++ ) {
            IERC20(_bAssets[i]).safeApprove(_mAsset, uint256(-1));
        }
    }


    /**
     * @dev 0. Simply saves an mAsset and then into the vault
     * @param _amount Units of mAsset to deposit to savings
     */
    function saveAndStake(uint256 _amount) external {
        IERC20(mAsset).transferFrom(msg.sender, address(this), _amount);
        uint256 credits = ISavingsContractV2(save).depositSavings(_amount);
        IBoostedSavingsVault(vault).stake(msg.sender, credits);
    }

    /**
     * @dev 1. Mints an mAsset and then deposits to SAVE
     * @param _bAsset       bAsset address
     * @param _amt          Amount of bAsset to mint with
     * @param _stake        Add the imUSD to the Savings Vault?
     */
    function saveViaMint(address _bAsset, uint256 _amt, bool _stake) external {
        // 1. Get the input bAsset
        IERC20(_bAsset).transferFrom(msg.sender, address(this), _amt);
        // 2. Mint
        IMasset mAsset_ = IMasset(mAsset);
        uint256 massetsMinted = mAsset_.mint(_bAsset, _amt);
        // 3. Mint imUSD and optionally stake in vault
        _saveAndStake(massetsMinted, _stake);
    }

    /**
     * @dev 2. Buys mUSD on Curve, mints imUSD and optionally deposits to the vault
     * @param _input         bAsset to sell
     * @param _curvePosition Index of the bAsset in the Curve pool
     * @param _minOutCrv     Min amount of mUSD to receive
     * @param _amountIn      Input asset amount
     * @param _stake         Add the imUSD to the Savings Vault?
     */
    function saveViaCurve(
        address _input,
        int128 _curvePosition,
        uint256 _amountIn,
        uint256 _minOutCrv,
        bool _stake
    ) external {
        // 1. Get the input asset
        IERC20(_input).transferFrom(msg.sender, address(this), _amountIn);
        // 2. Purchase mUSD
        uint256 purchased = curve.exchange_underlying(_curvePosition, 0, _amountIn, _minOutCrv);
        // 3. Mint imUSD and optionally stake in vault
        _saveAndStake(purchased, _stake);
    }

    /**
     * @dev Gets estimated mAsset output from a Curve trade
     */
    function estimate_saveViaCurve(
        int128 _curvePosition,
        uint256 _amountIn
    )
        external
        view
        returns (uint256 out)
    {
        return curve.get_dy(_curvePosition, 0, _amountIn);
    }

    /**
     * @dev 3. Buys a bAsset on Uniswap with ETH then mUSD on Curve
     * @param _amountOutMin  bAsset to sell
     * @param _path          Sell path on Uniswap (e.g. [WETH, DAI])
     * @param _curvePosition Index of the bAsset in the Curve pool
     * @param _minOutCrv     Min amount of mUSD to receive
     * @param _stake         Add the imUSD to the Savings Vault?
     */
    function saveViaUniswapETH(
        uint256 _amountOutMin,
        address[] calldata _path,
        int128 _curvePosition,
        uint256 _minOutCrv,
        bool _stake
    ) external payable {
        // 1. Get the bAsset
        uint[] memory amounts = uniswap.swapExactETHForTokens.value(msg.value)(
            _amountOutMin,
            _path,
            address(this),
            now + 1000
        );
        // 2. Purchase mUSD
        uint256 purchased = curve.exchange_underlying(_curvePosition, 0, amounts[amounts.length-1], _minOutCrv);
        // 3. Mint imUSD and optionally stake in vault
        _saveAndStake(purchased, _stake);
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
        return curve.get_dy(_curvePosition, 0, estimatedBasset);
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