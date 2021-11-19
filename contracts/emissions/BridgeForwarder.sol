// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { IRootChainManager } from "../interfaces/IRootChainManager.sol";
import { InitializableRewardsDistributionRecipient } from "../rewards/InitializableRewardsDistributionRecipient.sol";
import { Initializable } from "../shared/@openzeppelin-2.5/Initializable.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  BridgeForwarder
 * @author mStable
 * @notice Deployed on Ethereum L1, this Bridge Forwarder sends reward tokens across the Polygon PoS Bridge to a
 *         specified recipient contract on the Polygon chain.
 * @dev    VERSION: 1.0
 *         DATE:    2021-10-28
 */
contract BridgeForwarder is
    IRewardsDistributionRecipient,
    Initializable,
    InitializableRewardsDistributionRecipient
{
    using SafeERC20 for IERC20;

    /// @notice Token the rewards are distributed in. eg MTA
    IERC20 public immutable REWARDS_TOKEN;
    /// @notice Polygon PoS Bridge contract that takes deposits on mainnet.
    IRootChainManager public immutable ROOT_CHAIN_MANAGER;
    /// @notice Polygon PoS Bridge contract that locks tokens on mainnet.
    address public immutable BRIDGE_TOKEN_LOCKER;
    /// @notice Polygon contract that will receive the bridged rewards on the Polygon chain
    address public immutable BRIDGE_RECIPIENT;

    event Forwarded(uint256 amount);

    /**
     * @param _nexus             mStable system Nexus address
     * @param _rewardsToken      First token that is being distributed as a reward. eg MTA
     * @param _bridgeTokenLocker Mainnet bridge contract that receives and locks tokens for the L2 bridge.
     * @param _rootChainManager  Mainnet contract called to deposit tokens to the L2 bridge.
     * @param _bridgeRecipient   Polygon contract that will receive the bridged rewards on the Polygon chain
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _bridgeTokenLocker,
        address _rootChainManager,
        address _bridgeRecipient
    ) InitializableRewardsDistributionRecipient(_nexus) {
        require(_rewardsToken != address(0), "Rewards token is zero");
        require(_bridgeTokenLocker != address(0), "Bridge locker is zero");
        require(_rootChainManager != address(0), "RootChainManager is zero");
        require(_bridgeRecipient != address(0), "Bridge recipient is zero");

        REWARDS_TOKEN = IERC20(_rewardsToken);
        BRIDGE_TOKEN_LOCKER = _bridgeTokenLocker;
        ROOT_CHAIN_MANAGER = IRootChainManager(_rootChainManager);
        BRIDGE_RECIPIENT = _bridgeRecipient;
    }

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     * @param _emissionsController mStable Emissions Controller that distributes MTA rewards
     */
    function initialize(address _emissionsController) external initializer {
        InitializableRewardsDistributionRecipient._initialize(_emissionsController);

        // Approve the L2 Bridge to transfer reward tokens from this contract
        REWARDS_TOKEN.safeApprove(BRIDGE_TOKEN_LOCKER, type(uint256).max);
    }

    /**
     * @notice Called by the Emissions Controller to trigger the processing of the weekly rewards.
     * @dev    The Emissions Controller has already transferred the MTA to this contract.
     * @param _rewards The amount of reward tokens that were distributed to this contract
     */
    function notifyRewardAmount(uint256 _rewards)
        external
        override(IRewardsDistributionRecipient)
        onlyRewardsDistributor
    {
        ROOT_CHAIN_MANAGER.depositFor(
            BRIDGE_RECIPIENT,
            address(REWARDS_TOKEN),
            abi.encode(_rewards)
        );

        emit Forwarded(_rewards);
    }

    /***************************************
                    GETTERS
    ****************************************/

    /**
     * @dev Gets the RewardsToken
     */
    function getRewardToken()
        external
        view
        override(IRewardsDistributionRecipient)
        returns (IERC20)
    {
        return REWARDS_TOKEN;
    }
}
