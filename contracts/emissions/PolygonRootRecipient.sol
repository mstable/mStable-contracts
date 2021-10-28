// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Internal
import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { IRootChainManager } from "../interfaces/IRootChainManager.sol";
import { InitializableRewardsDistributionRecipient } from "../rewards/InitializableRewardsDistributionRecipient.sol";
import { Initializable } from "../shared/@openzeppelin-2.5/Initializable.sol";

// Libs
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  PolygonRootRecipient
 * @author mStable
 * @notice sends reward tokens across the Polygon PoS Bridge to a specified recipient contract on the Polygon chain.
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-28
 */
contract PolygonRootRecipient is IRewardsDistributionRecipient, Initializable, InitializableRewardsDistributionRecipient
{
    using SafeERC20 for IERC20;

    /// @notice token the rewards are distributed in. eg MTA
    IERC20 public immutable rewardsToken;
    /// @notice Mainnet Proof of Stake (PoS) bridge contract to Polygon.
    IRootChainManager public immutable rootChainManager;
    /// @notice Polygon contract that will receive the bridged rewards on the Polygon chain.
    address public immutable childRecipient;

    /**
     * @param _nexus mStable system Nexus address
     * @param _rewardsToken first token that is being distributed as a reward. eg MTA
     * @param _rootChainManager Mainnet Proof of Stake (PoS) bridge contract to Polygon.
     * @param _childRecipient Polygon contract that will receive the bridged rewards on the Polygon chain.
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _rootChainManager,
        address _childRecipient
    )
        InitializableRewardsDistributionRecipient(_nexus)
    {
        require(_rewardsToken != address(0), "Rewards token is zero");
        require(_rootChainManager != address(0), "RootChainManager is zero");
        require(_childRecipient != address(0), "ChildRecipient is zero");

        rewardsToken = IERC20(_rewardsToken);
        rootChainManager = IRootChainManager(_rootChainManager);
        childRecipient = _childRecipient;
    }

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     * @param _emissionsController mStable Emissions Controller that distributes MTA rewards
     */
    function initialize(
        address _emissionsController
    ) external initializer {
        InitializableRewardsDistributionRecipient._initialize(_emissionsController);

        // Approve the Polygon PoS Bridge to transfer reward tokens from this contract
        rewardsToken.safeApprove(address(rootChainManager), type(uint256).max);
    }

    /**
     * @notice is called by the Emissions Controller to trigger the processing of the weekly rewards.
     * @param _rewards the amount of reward tokens that were distributed to this contract.
     * @dev the Emissions Controller has already transferred the MTA to this contract.
     */
    function notifyRewardAmount(uint256 _rewards)
        external
        override(IRewardsDistributionRecipient)
        onlyRewardsDistributor
    {
        rootChainManager.depositFor(childRecipient, address(rewardsToken), abi.encode(_rewards));
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
        return rewardsToken;
    }
}