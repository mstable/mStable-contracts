// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

// Libs
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { AbstractIntegration } from "./AbstractIntegration.sol";

// Interfaces
import { IDudPlatform } from "./IDudPlatform.sol";

/**
 * @title   DudIntegration
 * @author  mStable
 * @notice  A simple connection to deposit and withdraw bAssets with no lending market
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-27
 */
contract DudIntegration is AbstractIntegration {
    using SafeERC20 for IERC20;

    event PlatformCleared(address indexed _integration, uint256 _value);

    /// @notice dudPlatform address
    /// @dev This is the address of the dudPlatform contract
    IDudPlatform public immutable platform;

    /// @notice base asset that is using the DudIntegration
    address public immutable bAsset;

    /// @notice Is the platform contract cleared already?
    /// @dev This is used to check if the platform contract is cleared already and to avoid depositing into the platform contract
    bool public cleared;

    /**
     * @param _nexus            Address of the Nexus
     * @param _lp               Address of LP
     * @param _bAsset           Address of of bAsset using the integration
     * @param _platform         Address of the dudPlatform contract
     */
    constructor(
        address _nexus,
        address _lp,
        address _bAsset,
        address _platform
    ) AbstractIntegration(_nexus, _lp) {
        require(_bAsset != address(0), "Invalid bAsset");
        require(_platform != address(0), "Invalid platform");
        bAsset = _bAsset;
        platform = IDudPlatform(_platform);
    }

    /**
     * @dev Approve the spending of the bAsset by the DudPlatform
     */
    function initialize() public initializer {
        _approveContracts();
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @dev Re-approve the spending of the bAsset by the DudPlatform
     *      if for some reason is it necessary. Only callable through Governance.
     */
    function reapproveContracts() external onlyGovernor {
        _approveContracts();
    }

    function _approveContracts() internal {
        // Approve platform contract to transfer bAssets for deposits.
        MassetHelpers.safeInfiniteApprove(bAsset, address(platform));
    }

    /**
     * @dev clears the platform of all the assets and sends back to the integration
     */

    function clear() external onlyGovernor {
        require(!cleared, "Already cleared");
        uint256 balance = IERC20(bAsset).balanceOf(address(platform));
        if (balance > 0) {
            platform.withdraw(bAsset, balance);
        }
        cleared = true;

        emit PlatformCleared(address(platform), balance);
    }

    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset
     * @param _bAsset              Address for the bAsset
     * @param _amount              Units of bAsset to deposit
     * @param _isTokenFeeCharged   Is the token fee charged
     * @return quantityDeposited   Quantity of bAsset that entered the platform
     */
    function deposit(
        address _bAsset,
        uint256 _amount,
        bool _isTokenFeeCharged
    ) external override onlyLP nonReentrant returns (uint256) {
        require(_isTokenFeeCharged == false, "Token fee cannot be charged");
        require(_amount > 0, "Must deposit something");
        require(_bAsset == bAsset, "Invalid bAsset");

        if (!cleared) {
            platform.deposit(bAsset, _amount);
        }

        emit Deposit(_bAsset, address(this), _amount);

        return _amount;
    }

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
        require(_amount > 0, "Must withdraw something");

        if (!cleared) {
            // Withdraw from the lending pool
            platform.withdraw(_bAsset, _totalAmount);
        }

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

        // Sending out the cached amount
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(0), _amount);
    }

    /**
     * @dev Get the total bAsset value
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset) external view override returns (uint256) {
        require(_bAsset == bAsset, "Invalid bAsset");
        return IERC20(_bAsset).balanceOf(address(platform));
    }

    /**
     * @dev function not used, but needs to be here because of the AbstractIntegration
     * @param _bAsset   Address of the bAsset
     * @param _pToken   Address of the pToken
     */
    function _abstractSetPToken(address _bAsset, address _pToken) internal override {}
}
