// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IGovernanceHook } from "../governance/staking/interfaces/IGovernanceHook.sol";
import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { IVotes } from "../interfaces/IVotes.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

struct DialData {
    uint128 weightedVotes;
    uint96 balance;
    address recipient;
    bool disabled;
    bool notify;
}

struct DialWeight {
    uint256 dialId;
    uint256 weight;
}

/**
 * @title  ChildEmissionsController
 * @author mStable
 * @notice Distributes the bridged rewards from the child recipients to the end recipients (vaults) on the Polygon chain.
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-28
 */
contract ChildEmissionsController is Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    IERC20 immutable childRewardToken;

    /// @notice maps the end recipient contracts, eg vaults, to the child recipients that receive rewards from the PoS Bridge.
    mapping(address => address) public recipientMap;

    // EVENTS

    event AddedDial(address indexed childRecipient, address indexed endRecipient);
    event DistributedReward(address indexed endRecipient, uint256 amount);

    /***************************************
                    INIT
    ****************************************/

    /** @notice Recipient is a module, governed by mStable governance
     * @param _nexus System nexus that resolves module addresses
     * @param _childRewardToken bridged rewards token on the Polygon chain that is distributed. eg MTA
     */
    constructor(
        address _nexus,
        address _childRewardToken
    ) ImmutableModule(_nexus) {
        require(_childRewardToken != address(0), "Reward token address is zero");
        childRewardToken = IERC20(_childRewardToken);
    }

    /**
     * @dev Initialize from the proxy
     */
    function initialize() external initializer {}

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @notice Adds a new mapping of a contract that receives rewards from the PoS Bridge to the contract that ultimately receives the rewards.
     * @param _childRecipient Address of the contract that will receive rewards
     * @param _endRecipient address of the contract that ultimately receive rewards and implements the `IRewardsDistributionRecipient` interface.
     */
    function addRecipient(address _childRecipient, address _endRecipient) external onlyGovernor {
        _addRecipient(_childRecipient, _endRecipient);
    }

    function _addRecipient(address _childRecipient, address _endRecipient) internal {
        require(_childRecipient != address(0), "Child recipient address is zero");
        require(_endRecipient != address(0), "End recipient address is zero");

        recipientMap[_endRecipient] = _childRecipient;

        emit AddedDial(_childRecipient, _endRecipient);
    }

    /**
     * @notice Transfers bridged rewards sitting in the child recipient contracts to the end recipient contracts
     * and the notifys them of the amount of rewards received.
     * @param _endRecipients list of contract addressess that ultimately receive rewards.
     */
    function distributeRewards(address[] memory _endRecipients) external {
        // For each specified dial
        uint256 len = _endRecipients.length;
        for (uint256 i = 0; i < len; i++) {
            // STEP 1 - get the child recipient from the recipient map
            address childRecipient = recipientMap[_endRecipients[i]];
            require(childRecipient != address(0), "Unmapped recipient");

            // STEP 2 - Get the balance of bridged rewards in the child recipient
            uint256 amount = childRewardToken.balanceOf(childRecipient);

            // STEP 3 - transfer the bridged rewards to the final recipient
            childRewardToken.safeTransferFrom(childRecipient, _endRecipients[i], amount);

            // STEP 4 - notify final recipient of received rewards
            IRewardsDistributionRecipient(_endRecipients[i]).notifyRewardAmount(
                amount
            );

            emit DistributedReward(_endRecipients[i], amount);
        }
    }
}