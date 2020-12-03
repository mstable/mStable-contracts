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
    using SafeMath for uint;
    address save;
    ICurveMetaPool curve;
    IUniswapV2Router02 uniswap;

    constructor(address _save, address _uniswapAddress, address _curveAddress, address _bAsset, uint _bAssetAmount) public {
        require(_save != address(0), "Invalid save address");
        save = _save;
        require(_uniswapAddress != address(0), "Invalid uniswap address");
        uniswap = IUniswapV2Router02(_uniswapAddress);
        require(_curveAddress != address(0), "Invalid curve address");
        curve = ICurveMetaPool(_curveAddress);
        IERC20(_bAsset).safeApprove(address(uniswap), _bAssetAmount);
        IERC20(_bAsset).safeApprove(address(uniswap), _bAssetAmount);
        IERC20(_bAsset).safeApprove(address(curve), _bAssetAmount);
    }

    function buyAndSave (
        address _bAsset,
        uint _bAssetAmount,
        uint _amountOutMin,
        address[] calldata _path,
        uint _deadline,
        int128 _curvePosition
        ) external {
        IERC20(_bAsset).transferFrom(msg.sender, address(this), _bAssetAmount);
        uint[] memory amounts = uniswap.swapExactTokensForTokens(
            _bAssetAmount,
            _amountOutMin,
            _path,
            address(save),
            _deadline
        );
        // I copied this from the Liquidator contract, I am unsure about the second and last parameter in crv fn)
        uint256 bAssetDec = IBasicToken(_bAsset).decimals();
        uint256 minOutCrv = _bAssetAmount.mul(95e16).div(10 ** bAssetDec);
        uint purchased = curve.exchange_underlying(_curvePosition, 0, amounts[1], minOutCrv);
        ISavingsContract(save).deposit(purchased, msg.sender);
    }

    // when you say off-chain does it mean we compute the values on the FE?
    function getAmountsOutForTokenValue(uint _bAssetAmount, address[] memory _path) public view returns (uint[] memory) {
        return uniswap.getAmountsOut(_bAssetAmount, _path);
    }

    function getEstimatedAmountForToken(uint _tokenAmount, address[] memory _path) public view returns (uint[] memory) {
        return uniswap.getAmountsIn(_tokenAmount, _path);
    }
}