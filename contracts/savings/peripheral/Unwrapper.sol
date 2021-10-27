import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

import { ISavingsContractV3 } from "../../interfaces/ISavingsContract.sol";
import { IMasset } from "../../interfaces/IMasset.sol";
import { IFeederPool } from "../../interfaces/IFeederPool";
import { IBoostedVaultWithLockup } from "../../interfaces/IBoostedVaultWithLockup.sol";

// Q: Should this be Governable?
contract Unwrapper is Ownable {
    enum RouteType {
        MassetRedeem,
        MassetSwap,
        FeederPoolRedeem,
        FeederPoolSwap
    }

    /// @dev Estimate output
    function getUnwrapOutput(
        RouteType _routeType,
        address _router,
        address _input,
        address _output,
        uint256 _amount
    ) public view returns (uint256 output) {
        if (_routeType == RouteType.MassetRedeem) {
            output = IMasset(_router).getRedeemOutput(_output, _amount);
        } else if (_routeType == RouteType.MassetSwap) {
            output = IMasset(_router).getSwapOutput(_input, _output, _amount);
        } else if (_routeType == RouteType.FeederPoolRedeem) {
            output = IFeederPool(_router).getRedeemOutput(_output, _amount);
        } else {
            output = IFeederPool(_router).getSwapOutput(_input, _output, _amount);
        }
    }

    /// @dev Unwrap and send
    function unwrapAndSend(
        RouteType _routeType,
        address _router,
        address _input,
        address _output,
        uint256 _amount,
        uint256 _minAmountOut,
        address _beneficiary
    ) external returns (uint256 outputQuantity) {
        require(IERC20(_input).transfer(address(this), _amount), "Transfer input");

        if (_routeType == RouteType.MassetRedeem) {
            outputQuantity = IMasset(_router).redeem(_output, _amount, _minAmountOut, _beneficiary);
        } else if (_routeType == RouteType.MassetSwap) {
            outputQuantity = IMasset(_router).swap(
                _input,
                _output,
                _amount,
                _minAmountOut,
                _beneficiary
            );
        } else if (_routeType == RouteType.FeederPoolRedeem) {
            outputQuantity = IFeederPool(_router).redeem(
                _output,
                _amount,
                _minAmountOut,
                _beneficiary
            );
        } else {
            outputQuantity = IFeederPool(_router).swap(
                _input,
                _output,
                _amount,
                _minAmountOut,
                _beneficiary
            );
        }
    }
}
