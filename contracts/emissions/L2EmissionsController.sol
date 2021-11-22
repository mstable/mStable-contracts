// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  L2EmissionsController
 * @author mStable
 * @notice Deployed on Polygon (or other L2's), this contract distributes the bridged rewards from the
 *         child recipients to the end recipients (vaults).
 * @dev    VERSION: 1.0
 *         DATE:    2021-10-28
 */
contract L2EmissionsController is Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    /// @notice ERC20 Reward token
    IERC20 immutable REWARD_TOKEN;

    /// @notice Maps the end recipient contracts, eg vaults, to the child recipients that receive rewards from the PoS Bridge.
    mapping(address => address) public recipientMap;

    event AddedDial(address indexed bridgeRecipient, address indexed endRecipient);
    event DistributedReward(address indexed endRecipient, uint256 amount);

    /***************************************
                    INIT
    ****************************************/

    /**
     * @notice Recipient is a module, governed by mStable governance system.
     * @param _nexus            System nexus that resolves module addresses
     * @param _childRewardToken Bridged rewards token on the Polygon chain that is distributed. eg MTA
     */
    constructor(address _nexus, address _childRewardToken) ImmutableModule(_nexus) {
        require(_childRewardToken != address(0), "Reward token address is zero");
        REWARD_TOKEN = IERC20(_childRewardToken);
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
     * @param _bridgeRecipient  Address of the contract that will receive rewards from the bridge
     * @param _endRecipient     Address of the contract that ultimately receive rewards and implements the `IRewardsDistributionRecipient` interface.
     */
    function addRecipient(address _bridgeRecipient, address _endRecipient) external onlyGovernor {
        _addRecipient(_bridgeRecipient, _endRecipient);
    }

    /**
     * @dev Internal addition fn, see parent
     */
    function _addRecipient(address _bridgeRecipient, address _endRecipient) internal {
        require(_bridgeRecipient != address(0), "Bridge recipient address is zero");
        require(_endRecipient != address(0), "End recipient address is zero");
        require(recipientMap[_endRecipient] == address(0), "End recipient already mapped");

        recipientMap[_endRecipient] = _bridgeRecipient;

        emit AddedDial(_bridgeRecipient, _endRecipient);
    }

    /**
     * @notice Transfers bridged rewards sitting in the child recipient contracts to the end recipient contracts
     *         and the notifys them of the amount of rewards received.
     * @param _endRecipients List of contract addressess that ultimately receive rewards.
     */
    function distributeRewards(address[] memory _endRecipients) external {
        // For each specified dial
        uint256 len = _endRecipients.length;
        for (uint256 i = 0; i < len; i++) {
            // 1.0 - get the child recipient from the recipient map
            address bridgeRecipient = recipientMap[_endRecipients[i]];
            require(bridgeRecipient != address(0), "Unmapped recipient");

            // 2.0 - Get the balance of bridged rewards in the child recipient
            uint256 amount = REWARD_TOKEN.balanceOf(bridgeRecipient);
            if (amount == 0) {
                continue;
            }

            // 3.0 - transfer the bridged rewards to the final recipient
            REWARD_TOKEN.safeTransferFrom(bridgeRecipient, _endRecipients[i], amount);

            // 4.0 - notify final recipient of received rewards
            IRewardsDistributionRecipient(_endRecipients[i]).notifyRewardAmount(amount);

            emit DistributedReward(_endRecipients[i], amount);
        }
    }
}
