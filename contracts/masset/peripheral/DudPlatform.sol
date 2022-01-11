// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

// Libs
import { MassetHelpers } from "../../shared/MassetHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";

/**
 * @title   DudPlatform
 * @author  mStable
 * @notice  A simple dud Platform that hold the amount of tokens in the platform. Needed because otherwise the migration of bAssets will fail due to the cached amount
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-27
 */
contract DudPlatform is Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    event PlatformDeposited(address indexed _integration, uint256 _value);
    event PlatformWithdrawn(address indexed _integration, uint256 _value);

    /// @notice base asset that is using the DudIntegration
    address public immutable bAsset;

    /// @notice The integration contract
    address public integration;

    modifier onlyIntegration() {
        require(msg.sender == integration, "Only integration");
        _;
    }

    /**
     * @param _nexus    Nexus contract address
     * @param _bAsset   Address of of bAsset using the integration
     */
    constructor(address _nexus, address _bAsset) ImmutableModule(_nexus) {
        require(_bAsset != address(0), "Invalid bAsset");
        bAsset = _bAsset;
    }

    /**
     * @dev attach the integration contract
     */
    function initialize(address _integration) public initializer {
        require(_integration != address(0), "Invalid integration");
        integration = _integration;
    }

    /***************************************
                    CORE
    ****************************************/

    /**
     * @dev deposits into the DudPlatform. 
     * @param _bAsset the address of the reserve
     * @param _amount the amount to be deposited

     **/
    function deposit(address _bAsset, uint256 _amount) external onlyIntegration {
        require(integration != address(0), "Integration not set");
        require(_bAsset == bAsset, "Invalid bAsset");
        require(_amount > 0, "Invalid amount");

        IERC20(bAsset).safeTransferFrom(integration, address(this), _amount);

        emit PlatformDeposited(integration, _amount);
    }

    /**
     * @dev withdraws the assets of user.
     * @param _bAsset the address of the reserve
     * @param _amount the underlying amount to be redeemed
     **/
    function withdraw(address _bAsset, uint256 _amount) external onlyIntegration {
        require(_bAsset == bAsset, "Invalid bAsset");
        require(_amount > 0, "Invalid amount");

        IERC20(bAsset).safeTransfer(integration, _amount);

        emit PlatformWithdrawn(integration, _amount);
    }
}
