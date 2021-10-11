// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IRewardsRecipientWithPlatformToken } from "../interfaces/IRewardsDistributionRecipient.sol";
import { IVotes } from "../interfaces/IVotes.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

struct DialData {
    // uint256 weight;
    uint256 weightedVotes;
    uint256 index;
    // mapping of staker addresses to the staker's dial weight
    // mapping (address => unit256) stakerWeights
}

struct DialWeight {
    address addr;
    uint256 weight;
}

/**
 * @title  EmissionsController
 * @author mStable
 * @notice 
 * @dev    
 */
contract EmissionsController is Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    /// @notice minimum time between distributions
    uint256 constant DistributionPeriod = 1 weeks;
    /// @notice total number of distributions. 52 weeks * 6 years
    uint256 constant Distributions = 312;
    /// @notice scale of dial weight and distribution rate
    uint256 constant SCALE = 1e18;
    
    IERC20 immutable rewardToken;
    uint256 immutable totalRewardsAmount;

    mapping(address => bool) public isVotingContract;
    IVotes[] public votingContracts;

    /// @notice list of dial addresses
    address[] public dials;
    /// @notice mapping of dial addresses to weights
    mapping (address => DialData) dialData;
    /// @notice total number of staker votes across all the dials
    uint256 totalDialVotes;

    /// @notice mapping of staker addresses to an list of voter dial weights.
    /// @dev the sum of the weights for each staker must equal SCALE = 1e18
    mapping (address => DialWeight[]) stakerDialWeights;

    /// @notice the start of the last distribution period which for 1 week periods, is 12am Thursday UTC
    uint256 public lastDistribution;

    // TODO replace with curve rather than linear
    uint256 public distributionRate;

    event AddedDial(address indexed _dial);
    event RemovedDial(address indexed _dial);
    event DistributedReward(
        address recipient,
        uint256 amount
    );

    modifier onlyVotingContract() {
        require(isVotingContract[msg.sender], "Must be whitelisted voting contract");
        _;
    }

    /** @notice Recipient is a module, governed by mStable governance
     * @param _nexus System nexus that resolves module addresses
     * @param _rewardToken token that rewards are distributed in. eg MTA
     * @param _votes gets a staker's voting power
     * @param _totalRewardsAmount rewards to be distributed over the live of the emissions
     */
    constructor(address _nexus, address[] memory _votes, address _rewardToken, uint256 _totalRewardsAmount) ImmutableModule(_nexus) {
        require(_rewardToken != address(0), "Reward token address is zero");
        rewardToken = IERC20(_rewardToken);
        totalRewardsAmount = _totalRewardsAmount;

        votingContracts = new IVotes[](_votes.length);
        for (uint256 i = 0; i < _votes.length; i++) {
            require(_votes[i] != address(0), "Votes address is zero");
            votingContracts[i] = IVotes(_votes[i]);
            isVotingContract[_votes[i]] = true;
        }

    }

    function initialize(address[] memory _dials, uint256 _distributionRate) public initializer {
        // Transfer all reward tokens for all future distributions to this distributor
        rewardToken.safeTransferFrom(msg.sender, address(this), totalRewardsAmount);

        for (uint256 i = 0; i < _dials.length; i++) {
            _addDial(_dials[i]);
        }

        // the last distribution will be set at the start of the current time period.
        // for a 1 week period, this is 12am Thursday UTC
        // This means the first distribution needs to be after 12am Thursday UTC
        lastDistribution = (block.timestamp / DistributionPeriod) * DistributionPeriod;

        distributionRate = _distributionRate;
    }

    /**
     * @dev 
     * @param _dial  Address of the new dial contract
     */
     // TODO need to add new dials via vote
    function addDial(address _dial) external onlyGovernor {
        _addDial(_dial);
    }

    function _addDial(address _dial) internal {
        require(_dial != address(0), "Dial address is zero");
        require(dialData[_dial].index == 0, "Dial aleady exists");

        dialData[_dial] = DialData({
            // weight: 0,
            weightedVotes: 0,
            index: dials.length
        });
        dials.push(_dial);

        emit AddedDial(_dial);
    }

    /**
     @notice delete dial if weight 0 to make distributeRewards more efficient
     */ 
    function removeDial(address _dial) external onlyGovernor {
        require(_dial != address(0), "Dial address is zero");
        uint256 index = dialData[_dial].index;
        require(index != 0, "Dial does not exist");
        // TODO unlikely weight will ever get to 0 so need to handle with staker weights left
        require(dialData[_dial].weightedVotes == 0, "Dial still has weight");

        dialData[_dial].index = 0;

        delete dials[index];

        emit RemovedDial(_dial);
    }

    /**
     * Gets the aggreaged voting power across all voting contracts
     */
    function getVotes(address staker) public returns (uint256 votingPower) {
        uint256 len = votingContracts.length;
        for (uint256 i = 0; i < len; i++) {
            votingPower += votingContracts[i].getVotes(staker);
        }
    }

    /**
     */
    function setVoterDialWeights(DialWeight[] memory _newDialWeights) external {
        // get staker's votes
        uint256 stakerVotes = getVotes(msg.sender);
        // load the total staker votes across all dials into memory
        uint256 totalDialVotesMem = totalDialVotes;

        // STEP 1 - adjust dial weighted votes from removed staker weighted votes
        DialWeight[] memory oldDialWeights = stakerDialWeights[msg.sender];
        uint oldTotalWeights;
        uint256 oldDialWeightsLen = oldDialWeights.length;
        if (oldDialWeightsLen > 0) {
            for (uint256 i = 0; i < oldDialWeightsLen; i++) {
                address dialAddr = oldDialWeights[i].addr;
                oldTotalWeights += oldDialWeights[i].weight;
                // reduce the dial weighted votes by old weight * staker votes / total staked votes
                dialData[dialAddr].weightedVotes -= oldDialWeights[i].weight * stakerVotes;
            }
            // Remove staker's old weighted votes from the total weighted votes
            totalDialVotesMem -= stakerVotes * oldTotalWeights;
            // clear the old weights as they will be added back below
            delete stakerDialWeights[msg.sender];
        }

        // STEP 2 - adjust dial weighted votes from added staker weighted votes
        uint256 newTotalWeight;
        uint256 newDialWeightsLen = _newDialWeights.length;
        if (newDialWeightsLen > 0) {
            for (uint256 i = 0; i < newDialWeightsLen; i++) {
                uint256 newStakerDialWeight = _newDialWeights[i].weight;
                newTotalWeight += newStakerDialWeight;
                // Add staker's dial weight
                stakerDialWeights[msg.sender].push(_newDialWeights[i]);

                // Add staker's weighted votes to dial
                address dialAddress = _newDialWeights[i].addr;
                dialData[dialAddress].weightedVotes += newStakerDialWeight * stakerVotes;
            }
            // Add staker's new weighted votes to the total amount of votes across all dials and save to storage
            totalDialVotes = totalDialVotesMem + (stakerVotes * newTotalWeight);
        }

        require(newTotalWeight <= SCALE, "Imbalanced weights");
    }

    /**
     * @notice called by the staking contract when a staker has added or removed staked rewards
     * 
     */
    function moveVotePower(address fromStaker, address toStaker, uint256 numVotes) external onlyVotingContract
    {
        // STEP 1 - update the total weighted votes across all dials
        // If from a mint of votes (stake)
        if (fromStaker == address(0)) {
            totalDialVotes += numVotes;
        }
        // else if a burn of votes (withdraw)
        else if (toStaker == address(0)) {
            totalDialVotes -= numVotes;
        }
        // if transferring votes from or to a delegate then no need to change the total dial votes

        // STEP 2 - Update the staker's dial weights
        // If burning (withdraw) or transferring delegated votes from a staker
        if (fromStaker != address(0)) {
            // for each staker's dial weight
            DialWeight[] memory stakerDialWeights = stakerDialWeights[fromStaker];
            uint256 len = stakerDialWeights.length;
            for (uint256 i = 0; i < len; i++) {
                DialWeight memory stakerDialWeight = stakerDialWeights[i];
                address dialAddress = stakerDialWeight.addr;

                // dial weighted votes = old weighted votes - (staker dial weight * votes)
                dialData[dialAddress].weightedVotes -= stakerDialWeight.weight * numVotes;
            }
        }

        // If minting (staking) or transferring delegated votes to a staker
        if (toStaker != address(0)) {
            // for each staker's dial weight
            DialWeight[] memory stakerDialWeights = stakerDialWeights[toStaker];
            uint256 len = stakerDialWeights.length;
            for (uint256 i = 0; i < len; i++) {
                DialWeight memory stakerDialWeight = stakerDialWeights[i];
                address dialAddress = stakerDialWeight.addr;

                // dial weighted votes = old weighted votes + (staker dial weight * votes)
                dialData[dialAddress].weightedVotes += stakerDialWeight.weight * numVotes;
            }
        }
    }

    // TODO change distribution to use a curve over time

    // TODO how will we handle platform amounts?
    function distributeRewards() external {
        // STEP 1 - check a new period has started
        require(block.timestamp > lastDistribution + DistributionPeriod, "Must wait for new period");
        lastDistribution = lastDistribution + DistributionPeriod;

        // STEP 2 - Calculate amount of rewards to distribute this week
        uint256 totalDistributionAmount = totalRewardsAmount * distributionRate / SCALE;

        // For each dial
        uint256 len = dials.length;
        for (uint256 i = 0; i < len; i++) {
            // STEP 3 - Calculate amount of rewards for the dial
            address dialAddress = dials[i];
            uint256 dialWeightedVotes = dialData[dialAddress].weightedVotes;
            if (dialWeightedVotes == 0) {
                continue;
            }
            uint256 dialDistributionAmount = totalDistributionAmount * dialWeightedVotes / (SCALE * totalDialVotes);

            // STEP 4 - Send the rewards the to the dial
            rewardToken.safeTransfer(dialAddress, dialDistributionAmount);

            // // Send the PlatformToken to recipient
            // uint256 platformAmount = _platformAmounts[i];
            // address platformTokenAddress = address(0);
            // if (platformAmount > 0) {
            //     IERC20 platformToken = recipient.getPlatformToken();
            //     platformTokenAddress = address(platformToken);
            //     platformToken.safeTransferFrom(msg.sender, address(recipient), platformAmount);
            // }

            // STEP 5 - notify the dial of the new rewards
            // Only after successful transer tx
            IRewardsRecipientWithPlatformToken(dialAddress).notifyRewardAmount(dialDistributionAmount);

            emit DistributedReward(
                dialAddress,
                dialDistributionAmount
            );
        }
    }
}
