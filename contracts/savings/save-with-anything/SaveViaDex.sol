pragma solidity 0.5.16;

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { ISavingsContract } from "../../interfaces/ISavingsContract.sol";
import { IUniswapV2Router02 } from "../../masset/liquidator/IUniswapV2Router02.sol";
import { ICurveMetaPool } from "../../masset/liquidator/ICurveMetaPool.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";

contract SaveViaUniswap {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    address save;
    ICurveMetaPool curve;
    IUniswapV2Router02 uniswap;
    address[] curveAssets;

    constructor(address _save, address _uniswapAddress, address _curveAddress, address _mAsset, address[] memory _curveAssets) public {
        require(_save != address(0), "Invalid save address");
        save = _save;
        require(_uniswapAddress != address(0), "Invalid uniswap address");
        uniswap = IUniswapV2Router02(_uniswapAddress);
        require(_curveAddress != address(0), "Invalid curve address");
        curve = ICurveMetaPool(_curveAddress);
        curveAssets = _curveAssets;
        IERC20(_mAsset).safeApprove(address(save), uint256(-1));
        for(uint256 i = 0; i < curveAssets.length; i++ ) {
            IERC20(curveAssets[i]).safeApprove(address(curve), uint256(-1));
        }
    }

    function swapOnCurve(
        uint _amount,
        int128 _curvePosition,
        uint256 _minOutCrv
    ) external {
        uint purchased = curve.exchange_underlying(_curvePosition, 0, _amount, _minOutCrv);
        ISavingsContract(save).deposit(purchased, msg.sender);
    }

    function swapOnUniswapWithEth(
        uint _amountOutMin,
        address[] calldata _path,
        uint _deadline,
        int128 _curvePosition,
        uint256 _minOutCrv
        ) external payable {
        require(msg.value <= address(this).balance, "Not enough Eth in contract to perform swap.");
        uint[] memory amounts = uniswap.swapExactETHForTokens.value(msg.value)(
            _amountOutMin,
            _path,
            address(save),
            _deadline
        );
        uint purchased = curve.exchange_underlying(_curvePosition, 0, amounts[amounts.length-1], _minOutCrv);
        ISavingsContract(save).deposit(purchased, msg.sender);
    }

    function swapOnUniswap(
        address _asset,
        uint256 _inputAmount,
        uint256 _amountOutMin,
        address[] calldata _path,
        uint256 _deadline,
        int128 _curvePosition,
        uint256 _minOutCrv
        ) external {
        IERC20(_asset).transferFrom(msg.sender, address(this), _inputAmount);
        IERC20(_asset).safeApprove(address(uniswap), _inputAmount);
        uint[] memory amounts = uniswap.swapExactTokensForTokens(
            _inputAmount,
            _amountOutMin,
            _path,
            address(save),
            _deadline
        );
        uint purchased = curve.exchange_underlying(_curvePosition, 0, amounts[amounts.length-1], _minOutCrv);
        ISavingsContract(save).deposit(purchased, msg.sender);
    }

    function getAmountsOutForTokenValue(uint256 _bAssetAmount, address[] memory _path) public view returns (uint[] memory) {
        return uniswap.getAmountsOut(_bAssetAmount, _path);
    }

    function getEstimatedAmountForToken(uint256 _tokenAmount, address[] memory _path) public view returns (uint[] memory) {
        return uniswap.getAmountsIn(_tokenAmount, _path);
    }
}