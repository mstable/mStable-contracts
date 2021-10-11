// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IGovernanceHook } from "../governance/staking/interfaces/IGovernanceHook.sol";
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
contract EmissionsController is IGovernanceHook, Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    // CONST

    /// @notice minimum time between distributions
    uint256 constant DISTRIBUTION_PERIOD = 1 weeks;
    /// @notice total number of distributions. 52 weeks * 6 years
    uint256 constant DISTRIBUTIONS = 312;
    /// @notice scale of dial weight and distribution rate
    uint256 constant SCALE = 1e18;

    // HIGH LEVEL EMISSION

    IERC20 immutable rewardToken;
    uint256 immutable totalRewardsAmount;
    /// @notice the start of the last distribution period which for 1 week periods, is 12am Thursday UTC
    uint256 public lastDistribution;
    // TODO replace with curve rather than linear
    uint256 public distributionRate;

    // VOTING

    // TODO - I propose we consolidate this array and mapping into an array of dials with `address` and `weightedVotes`
    // this means we can just store all user preferences in a bitmap using `id` and `weight` rather than storing addresses
    /// @notice list of dial addresses
    address[] public dials;
    /// @notice mapping of dial addresses to weights
    mapping(address => DialData) dialData;
    /// @notice total number of staker votes across all the dials
    uint256 totalDialVotes;
    /// @notice mapping of staker addresses to an list of voter dial weights.
    /// @dev the sum of the weights for each staker must equal SCALE = 1e18
    // TODO - if the sum must be == 1e18, then why do `totalDialVotesMem -= stakerVotes * oldTotalWeights;` in setVoterDialWeights
    // I propose we either store the sum, make it calculable from 1 SLOAD, or fix it to 1e18
    mapping(address => DialWeight[]) stakerDialWeights;

    // CONFIG

    mapping(address => bool) public isStakingContract;
    IVotes[] public stakingContracts;

    // EVENTS

    event AddedDial(address indexed _dial);
    event RemovedDial(address indexed _dial);
    event DistributedReward(address recipient, uint256 amount);

    modifier onlyStakingContract() {
        require(isStakingContract[msg.sender], "Must be whitelisted staking contract");
        _;
    }

    /***************************************
                    INIT
    ****************************************/

    /** @notice Recipient is a module, governed by mStable governance
     * @param _nexus System nexus that resolves module addresses
     * @param _rewardToken token that rewards are distributed in. eg MTA
     * @param _votes gets a staker's voting power
     * @param _totalRewardsAmount rewards to be distributed over the live of the emissions
     */
    constructor(
        address _nexus,
        address[] memory _votes,
        address _rewardToken,
        uint256 _totalRewardsAmount
    ) ImmutableModule(_nexus) {
        require(_rewardToken != address(0), "Reward token address is zero");
        rewardToken = IERC20(_rewardToken);
        totalRewardsAmount = _totalRewardsAmount;

        stakingContracts = new IVotes[](_votes.length);
        for (uint256 i = 0; i < _votes.length; i++) {
            require(_votes[i] != address(0), "Votes address is zero");
            stakingContracts[i] = IVotes(_votes[i]);
            isStakingContract[_votes[i]] = true;
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
        lastDistribution = (block.timestamp / DISTRIBUTION_PERIOD) * DISTRIBUTION_PERIOD;

        distributionRate = _distributionRate;
    }

    /***************************************
                    VIEW
    ****************************************/

    /**
     * @notice Gets the aggreaged voting power across all voting contracts
     */
    function getVotes(address staker) public returns (uint256 votingPower) {
        uint256 len = stakingContracts.length;
        for (uint256 i = 0; i < len; i++) {
            votingPower += stakingContracts[i].getVotes(staker);
        }
    }

    /***************************************
                    ADMIN
    ****************************************/

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

        dialData[_dial] = DialData({ weightedVotes: 0, index: dials.length });
        dials.push(_dial);

        emit AddedDial(_dial);
    }

    /**
     * @notice delete dial if weight 0 to make distributeRewards more efficient
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

    // TODO change distribution to use a curve over time
    // TODO how will we handle platform amounts?
    function distributeRewards() external {
        // STEP 1 - check a new period has started
        require(
            block.timestamp > lastDistribution + DISTRIBUTION_PERIOD,
            "Must wait for new period"
        );
        lastDistribution = lastDistribution + DISTRIBUTION_PERIOD;

        // STEP 2 - Calculate amount of rewards to distribute this week
        uint256 totalDistributionAmount = (totalRewardsAmount * distributionRate) / SCALE;

        // For each dial
        uint256 len = dials.length;
        for (uint256 i = 0; i < len; i++) {
            // STEP 3 - Calculate amount of rewards for the dial
            address dialAddress = dials[i];
            uint256 dialWeightedVotes = dialData[dialAddress].weightedVotes;
            if (dialWeightedVotes == 0) {
                continue;
            }
            uint256 dialDistributionAmount = (totalDistributionAmount * dialWeightedVotes) /
                (SCALE * totalDialVotes);

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
            IRewardsRecipientWithPlatformToken(dialAddress).notifyRewardAmount(
                dialDistributionAmount
            );

            emit DistributedReward(dialAddress, dialDistributionAmount);
        }
    }

    /***************************************
                VOTING-EXTERNAL
    ****************************************/

    /**
     */
    function setVoterDialWeights(DialWeight[] memory _newDialWeights) external {
        // get staker's votes
        uint256 stakerVotes = getVotes(msg.sender);

        // STEP 1 - adjust dial weighted votes from removed staker weighted votes
        DialWeight[] memory oldDialWeights = stakerDialWeights[msg.sender];
        uint256 oldLen = oldDialWeights.length;
        uint256 oldTotalWeights;
        if (oldLen > 0) {
            _moveVotingPower(msg.sender, stakerVotes, _subtract);

            for (uint256 i = 0; i < oldLen; i++) {
                oldTotalWeights += oldDialWeights[i].weight;
            }
            // Remove staker's old weighted votes from the total weighted votes
            totalDialVotes -= (stakerVotes * oldTotalWeights) / 1e18;
            // clear the old weights as they will be added back below
            delete stakerDialWeights[msg.sender];
        }

        // STEP 2 - adjust dial weighted votes from added staker weighted votes
        uint256 newTotalWeight;
        uint256 newLen = _newDialWeights.length;
        if (newLen > 0) {
            for (uint256 i = 0; i < newLen; i++) {
                newTotalWeight += _newDialWeights[i].weight;
                // Add staker's dial weight
                stakerDialWeights[msg.sender].push(_newDialWeights[i]);
            }
            // Add staker's new weighted votes to the total amount of votes across all dials and save to storage
            totalDialVotes += (stakerVotes * newTotalWeight) / 1e18;

            _moveVotingPower(msg.sender, stakerVotes, _add);
        }

        require(newTotalWeight <= SCALE, "Imbalanced weights");
    }

    /**
     * @notice called by the staking contract when a staker has added or removed staked rewards
     */
    function moveVotingPowerHook(
        address from,
        address to,
        uint256 amount
    ) external override onlyStakingContract {
        // STEP 1 - update the total weighted votes across all dials
        // if transferring votes from or to a delegate then no need to change the total dial votes
        if (amount > 0) {
            // If from a mint of votes (stake)
            if (from == address(0)) {
                totalDialVotes += amount;
            }
            // else if a burn of votes (withdraw)
            else if (to == address(0)) {
                totalDialVotes -= amount;
            }

            // STEP 2 - Update the staker's dial weights
            // If burning (withdraw) or transferring delegated votes from a staker
            if (from != address(0)) {
                _moveVotingPower(from, amount, _subtract);
            }
            // If minting (staking) or transferring delegated votes to a staker
            if (to != address(0)) {
                _moveVotingPower(to, amount, _subtract);
            }
        }
    }

    /***************************************
                VOTING-INTERNAL
    ****************************************/

    function _moveVotingPower(
        address _voter,
        uint256 _amount,
        function(uint256, uint256) view returns (uint256) _op
    ) internal {
        DialWeight[] memory preferences = stakerDialWeights[_voter];
        uint256 len = preferences.length;
        for (uint256 i = 0; i < len; i++) {
            DialWeight memory pref = preferences[i];
            // e.g. 5e17 * 1e18 / 1e18 * 100e18 / 1e18
            // = 50e18
            uint256 amountToChange = (pref.weight * _amount) / 1e18;
            dialData[pref.addr].weightedVotes = _op(
                dialData[pref.addr].weightedVotes,
                amountToChange
            );
        }
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) {
        return a + b;
    }

    function _subtract(uint256 a, uint256 b) private pure returns (uint256) {
        return a - b;
    }
}
