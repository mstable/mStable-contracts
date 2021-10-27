// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

// External
import { IAaveATokenV2, IAaveLendingPoolV2, ILendingPoolAddressesProviderV2 } from "../../peripheral/Aave/IAave.sol";

// Libs
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AbstractIntegration } from "./AbstractIntegration.sol";

/**
 * @title   DudIntegration
 * @author  mStable
 * @notice  A simple connection to deposit and withdraw bAssets with no lending market
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-27
 */
contract DudIntegration is AbstractIntegration {
    using SafeERC20 for IERC20;

    // TODO - support virtual amount here
    uint256 pseudoDeposited = 0;

    // increase on deposit
    // decrease on totalWithdraw
    // return balance from checkbalance

    /**
     * @param _nexus            Address of the Nexus
     * @param _lp               Address of LP
     */
    constructor(address _nexus, address _lp) AbstractIntegration(_nexus, _lp) {}

    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset
     * @param _bAsset              Address for the bAsset
     * @param _amount              Units of bAsset to deposit
     * @param _hasTxFee            Is the bAsset known to have a tx fee?
     * @return quantityDeposited   Quantity of bAsset that entered the platform
     */
    function deposit(
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    ) external override onlyLP nonReentrant returns (uint256 quantityDeposited) {}

    /**
     * @dev Withdraw a quantity of bAsset from the platform
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     * @param _hasTxFee     Is the bAsset known to have a tx fee?
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    ) external override onlyLP nonReentrant {
        _withdraw(_receiver, _bAsset, _amount, _amount, _hasTxFee);
    }

    /**
     * @dev Withdraw a quantity of bAsset from the platform
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to send to recipient
     * @param _totalAmount  Total units to pull from lending platform
     * @param _hasTxFee     Is the bAsset known to have a tx fee?
     */
    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool _hasTxFee
    ) external override onlyLP nonReentrant {
        _withdraw(_receiver, _bAsset, _amount, _totalAmount, _hasTxFee);
    }

    /** @dev Withdraws _totalAmount from the lending pool, sending _amount to user */
    function _withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool /* _hasTxFee */
    ) internal {
        require(_totalAmount > 0, "Must withdraw something");

        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit PlatformWithdrawal(_bAsset, _bAsset, _totalAmount, _amount);
    }

    /**
     * @dev Withdraw a quantity of bAsset from the cache.
     * @param _receiver     Address to which the bAsset should be sent
     * @param _bAsset       Address of the bAsset
     * @param _amount       Units of bAsset to withdraw
     */
    function withdrawRaw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    ) external override onlyLP nonReentrant {
        require(_amount > 0, "Must withdraw something");
        require(_receiver != address(0), "Must specify recipient");

        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(0), _amount);
    }

    /**
     * @dev Get the total bAsset value
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(
        address /* _bAsset */
    ) external view override returns (uint256 balance) {
        return 0;
    }

    function _abstractSetPToken(address _bAsset, address _pToken) internal override {}
}
