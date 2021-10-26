// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IRevenueRecipient } from "../interfaces/IRevenueRecipient.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title   RevenueForwarder
 * @author  mStable
 * @notice  Sends to trusted forwarded
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-26
 */
contract RevenueForwarder is IRevenueRecipient, ImmutableModule {
    using SafeERC20 for IERC20;

    event RevenueReceived(address indexed mAsset, uint256 amountIn);
    event Withdrawn(uint256 amountOut);

    IERC20 public immutable musd;

    address public immutable keeper;
    address public forwarder;

    constructor(
        address _nexus,
        address _musd,
        address _keeper,
        address _forwarder
    ) ImmutableModule(_nexus) {
        musd = IERC20(_musd);
        keeper = _keeper;
        forwarder = _forwarder;
    }

    modifier keeperOrGovernor() {
        require(msg.sender == keeper || msg.sender == _governor(), "Only keeper or governor");
        _;
    }

    /**
     * @dev Simply transfers the mAsset from the sender to here
     * @param _mAsset Address of mAsset
     * @param _amount Units of mAsset collected
     */
    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external override {
        require(_mAsset == address(musd), "This Recipient is only for mUSD");
        // Transfer from sender to here
        IERC20(_mAsset).safeTransferFrom(msg.sender, address(this), _amount);

        emit RevenueReceived(_mAsset, _amount);
    }

    /**
     * @dev Withdraws to forwarder
     */
    function forward() external keeperOrGovernor {
        uint256 amt = musd.balanceOf(address(this));
        musd.safeTransfer(forwarder, amt);

        emit Withdrawn(amt);
    }

    /**
     * @dev Sets details
     * @param _forwarder new forwarder
     */
    function setConfig(address _forwarder) external onlyGovernor {
        require(_forwarder != address(0), "Invalid forwarder");
        forwarder = _forwarder;
    }

    /**
     * @dev Abstract override
     */
    function depositToPool(
        address[] calldata, /* _mAssets */
        uint256[] calldata /* _percentages */
    ) external override {}
}
