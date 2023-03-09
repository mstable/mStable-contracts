// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// External
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice  Allows to redeem MTA for WETH at a fixed rate.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2023-03-08
 */
contract MetaTokenRedeemer {
    using SafeERC20 for IERC20;

    uint256 public constant RATE_SCALE = 1e18;
    address public immutable MTA;
    address public immutable WETH;
    uint256 public immutable RATE;

    /**
     * @notice Emits event whenever a user funds and amount.
     */
    event Funded(address indexed from, uint256 amount);

    /**
     * @notice Emits event whenever a user redeems an amount.
     */
    event Redeemed(address indexed sender, uint256 fromAssetAmount, uint256 toAssetAmount);

    /**
     * @notice Crates a new instance of the contract
     * @param _mta MTA Token Address
     * @param _weth WETH Token Address
     * @param _rate The exchange rate with 18 decimal numbers, for example 1 MTA  = 0.00002 ETH  rate is 20000000000000;
     */
    constructor(
        address _mta,
        address _weth,
        uint256 _rate
    ) {
        MTA = _mta;
        WETH = _weth;
        RATE = _rate;
    }

    /// @notice Funds the contract with WETH.
    /// @param amount Amount of WETH to be transfer to the contract
    function fund(uint256 amount) external {
        IERC20(WETH).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    /// @notice Redeems MTA for WETH at a fixed rate.
    /// @param fromAssetAmount a parameter just like in doxygen (must be followed by parameter name)
    /// @return toAssetAmount The amount of WETH received.
    function redeem(uint256 fromAssetAmount) external returns (uint256 toAssetAmount) {
        IERC20(MTA).safeTransferFrom(msg.sender, address(this), fromAssetAmount);

        // calculate to asset amount
        toAssetAmount = (fromAssetAmount * RATE) / RATE_SCALE;

        // transfer out the to asset
        require(IERC20(WETH).balanceOf(address(this)) >= toAssetAmount, "not enough WETH");

        IERC20(WETH).safeTransfer(msg.sender, toAssetAmount);

        emit Redeemed(msg.sender, fromAssetAmount, toAssetAmount);
    }
}
