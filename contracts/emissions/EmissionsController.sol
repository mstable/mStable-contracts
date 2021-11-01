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

struct Preference {
    uint8 dialId;
    uint8 weight;
}

/**
 * @title  EmissionsController
 * @author mStable
 * @notice Calculates the weekly rewards to be sent to each dial based on governance votes.
 */
contract EmissionsController is IGovernanceHook, Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    // CONST

    /// @notice minimum time between distributions
    uint256 constant DISTRIBUTION_PERIOD = 1 weeks;
    /// @notice scale of dial weights. 200 = 100%, 2 = 1%, 1 = 0.5%
    uint256 constant SCALE = 200;

    // HIGH LEVEL EMISSION

    IERC20 immutable rewardToken;

    /// @notice the rewards that are still to be distributed
    uint256 public remainingRewards;
    /// @notice number of weekly distributions left
    uint256 public remainingDistributions;
    /// @notice the start of the last distribution period which for 1 week periods, is 12am Thursday UTC
    uint256 public lastDistribution;

    // VOTING

    /// @dev The number of staking contracts is fixed for each implementation.
    /// More can be added but requires the proxy contract to be upgraded to a new implementation
    uint256 constant NumStakingContract = 2;
    IVotes immutable stakingContract1;
    IVotes immutable stakingContract2;
    // More immutable variables can be added if the contract is upgraded
    // IVotes immutable stakingContract3;
    // IVotes immutable stakingContract4;

    /// @notice list of dial data including weightedVotes, rewards balance, recipient contract and disabled flag.
    DialData[] public dials;
    /// @notice mapping of staker addresses to an list of voter dial weights.
    /// @dev the sum of the weights for each staker must not be greater than SCALE = 10000.
    /// A user can issue a subset of their voting power. eg only 20% of their voting power.
    /// A user can not issue more than 100% of their voting power across dials.
    mapping(address => Preference[16]) public stakerPreferences;

    // EVENTS

    event AddedDial(uint256 indexed id, address indexed recipient);
    event UpdatedDial(uint256 indexed id, bool diabled);
    event AddedRewards(uint256 rewards);
    event PeriodRewards(uint256[] amounts);
    event DonatedRewards(uint256 indexed dialId, uint256 amount);
    event DistributedReward(uint256 indexed dialId, uint256 amount);

    modifier onlyStakingContract() {
        require(
            address(stakingContract1) == msg.sender || address(stakingContract2) == msg.sender,
            // Add if contract is upgraded with more staking contracts
            // address(stakingContract3) == msg.sender ||
            // address(stakingContract4) == msg.sender,
            "Must be staking contract"
        );
        _;
    }

    /***************************************
                    INIT
    ****************************************/

    /** @notice Recipient is a module, governed by mStable governance
     * @param _nexus System nexus that resolves module addresses
     * @param _stakingContracts two staking contract with voting power
     * @param _rewardToken token that rewards are distributed in. eg MTA
     */
    constructor(
        address _nexus,
        address[NumStakingContract] memory _stakingContracts,
        address _rewardToken
    ) ImmutableModule(_nexus) {
        require(_rewardToken != address(0), "Reward token address is zero");
        rewardToken = IERC20(_rewardToken);

        require(
            _stakingContracts[0] != address(0) && _stakingContracts[1] != address(0),
            "Staking contract address is zero"
        );
        stakingContract1 = IVotes(_stakingContracts[0]);
        stakingContract2 = IVotes(_stakingContracts[1]);
        // Add if contract is upgraded to include more staking contracts.
        // stakingContract2 = IVotes(_stakingContracts[2]);
        // stakingContract3 = IVotes(_stakingContracts[3]);
    }

    /**
     * @dev Initialize function to configure the first dials.
     * @param _recipients list of dial contract addressess that can receive rewards.
     * @param _notifies list of dial notify flags. If true, `notifyRewardAmount` is called in the `distributeRewards` function.
     * @dev all recipient contracts need to implement the `IRewardsDistributionRecipient` interface.
     */
    function initialize(address[] memory _recipients, bool[] memory _notifies)
        external
        initializer
    {
        uint256 len = _recipients.length;
        require(_notifies.length == len, "Initialize args mistmatch");

        // STEP 0 - Init the dials, setting pos0 = empty
        _addDial(address(1), false);
        dials[0].disabled = true;

        // STEP 1 - calculate how many distributions. 52 weeks * 6 years = 312
        remainingDistributions = 312;

        // STEP 2 - Add each of the dials
        for (uint256 i = 0; i < len; i++) {
            _addDial(_recipients[i], _notifies[i]);
        }

        // STEP 3 - the last distribution will be set at the end of the current time period.
        // for a 1 week period, this is 12am Thursday UTC
        // This means the first distribution needs to be after 12am Thursday UTC
        // It also means there is this period and next to vote beofre the first distribution
        lastDistribution =
            ((block.timestamp + 1 weeks) / DISTRIBUTION_PERIOD) *
            DISTRIBUTION_PERIOD;
    }

    /***************************************
                    VIEW
    ****************************************/

    /**
     * @notice Gets the aggreaged voting power across all voting contracts.
     * @dev Voting power can be from staking or it could be delegated to the account.
     * @param account that has voting power.
     */
    function getVotes(address account) public returns (uint256 votingPower) {
        votingPower = stakingContract1.getVotes(account);
        votingPower += stakingContract2.getVotes(account);
        // Add if contract is upgraded to include more staking contracts
        // votingPower += stakingContract3.getVotes(account);
        // votingPower += stakingContract4.getVotes(account);
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @notice Adds a new dial that can be voted on to receive weekly rewards.
     * @param _recipient Address of the contract that will receive rewards
     * @param _notify If true, `notifyRewardAmount` is called in the `distributeRewards` function.
     */
    function addDial(address _recipient, bool _notify) external onlyGovernor {
        _addDial(_recipient, _notify);
    }

    function _addDial(address _recipient, bool _notify) internal {
        require(_recipient != address(0), "Dial address is zero");

        uint256 len = dials.length;
        require(len < 254, "Max dial count reached");
        for (uint256 i = 0; i < len; i++) {
            require(dials[i].recipient != _recipient, "Dial already exists");
        }

        dials.push(
            DialData({
                weightedVotes: 0,
                balance: 0,
                recipient: _recipient,
                disabled: false,
                notify: _notify
            })
        );

        emit AddedDial(len, _recipient);
    }

    /**
     * @notice Updates a dials recipient contract and/or disabled flag.
     * @param _dialId Dial identifier
     * @param _disabled If true, no rewards will be distributed to this dial
     */
    function updateDial(uint256 _dialId, bool _disabled) external onlyGovernor {
        require(_dialId > 0 && _dialId < dials.length, "Invalid dial id");

        dials[_dialId].disabled = _disabled;

        emit UpdatedDial(_dialId, _disabled);
    }

    /**
     * @notice Adds rewards to the Emission Controller for future distributions.
     * @param from account that the rewards will be transferred from. This can be different to the msg sender.
     * @param rewards the number of rewards to be transferred to the Emissions Controller
     */
    function addRewards(address from, uint256 rewards) external onlyGovernor {
        require(rewards > 0, "Zero rewards");

        rewardToken.safeTransferFrom(from, address(this), rewards);
        remainingRewards += rewards;

        emit AddedRewards(rewards);
    }

    /***************************************
                    REWARDS-EXTERNAL
    ****************************************/

    /**
     * @notice allows anyone to donate rewards to a dial on top of the weekly rewards.
     * @param _dialIds Dial identifiers that will receive donated rewards
     * @param _amounts Number of rewards to be sent to each dial including decimals.
     */
    function donate(uint256[] memory _dialIds, uint256[] memory _amounts) external {
        uint256 dialLen = _dialIds.length;
        require(dialLen > 0 && _amounts.length == dialLen, "Invalid inputs");

        uint256 totalAmount;

        // For each specified dial
        uint256 dialId;
        for (uint256 i = 0; i < dialLen; i++) {
            dialId = _dialIds[i];
            require(dialId > 0 && dialId < dials.length, "Invalid dial id");

            // Sum the rewards for each dial
            totalAmount += _amounts[i];
            // Add rewards to the dial's rewards balance
            dials[dialId].balance += SafeCast.toUint96(_amounts[i]);

            emit DonatedRewards(dialId, _amounts[i]);
        }

        // Transfer the total donated rewards to this Emissions Controller contract
        rewardToken.safeTransferFrom(msg.sender, address(this), totalAmount);
    }

    /**
     * @notice calculates the rewards to be distributed to each dial
     * at the start of a period.
     */
    function calculateRewards() external {
        // STEP 1 - check a new period has started
        require(
            block.timestamp > lastDistribution + DISTRIBUTION_PERIOD,
            "Must wait for new period"
        );
        lastDistribution = lastDistribution + DISTRIBUTION_PERIOD;

        // STEP 2 - Calculate amount of rewards to distribute this week
        // TODO replace with curve rather than linear
        uint256 totalDistributionAmount = remainingRewards / remainingDistributions;
        remainingRewards -= totalDistributionAmount;
        remainingDistributions -= 1;

        // STEP 3 - Calculate the total amount of dial votes ignoring any disabled dials
        uint256 totalDialVotes;
        uint256 dialLen = dials.length;
        // For each dial
        for (uint256 i = 0; i < dialLen; i++) {
            // STEP 3 - Calculate amount of rewards for the dial
            uint256 dialWeightedVotes = dials[i].weightedVotes;
            if (dialWeightedVotes == 0 || dials[i].disabled) {
                continue;
            }
            totalDialVotes += dials[i].weightedVotes;
        }

        // STEP 4 - Calculate the distribution amounts for each dial
        // For each dial
        uint256[] memory distributionAmounts = new uint256[](dialLen);
        for (uint256 i = 0; i < dialLen; i++) {
            uint256 dialWeightedVotes = dials[i].weightedVotes;
            // Skip dial if no votes or disabled
            if (dialWeightedVotes == 0 || dials[i].disabled) {
                continue;
            }
            // Calculate amount of rewards for the dial
            distributionAmounts[i] = (totalDistributionAmount * dialWeightedVotes) / totalDialVotes;

            // Update dial's rewards balance
            dials[i].balance += SafeCast.toUint96(distributionAmounts[i]);
        }

        emit PeriodRewards(distributionAmounts);
    }

    /**
     * @notice Transfers all accrued rewards to dials and notifies them of the amount.
     * @param _dialIds Dial identifiers that will receive distributed rewards
     */
    function distributeRewards(uint256[] memory _dialIds) external {
        // For each specified dial
        uint256 len = _dialIds.length;
        for (uint256 i = 0; i < len; i++) {
            require(_dialIds[i] < dials.length, "Invalid dial id");
            DialData memory dialData = dials[_dialIds[i]];

            // STEP 1 - Get the dial's reward balance
            if (dialData.balance == 0) {
                continue;
            }

            // STEP 2 - Send the rewards the to the dial recipient
            rewardToken.safeTransfer(dialData.recipient, dialData.balance);

            // STEP 3 - notify the dial of the new rewards if configured to
            // Only after successful transer tx
            if (dialData.notify) {
                IRewardsDistributionRecipient(dialData.recipient).notifyRewardAmount(
                    dialData.balance
                );
            }

            emit DistributedReward(_dialIds[i], dialData.balance);

            // STEP 4 - Reset the balance in storage back to 0
            dials[_dialIds[i]].balance = 0;
        }
    }

    /***************************************
                VOTING-EXTERNAL
    ****************************************/

    /**
     * @notice allows a staker to proportion their voting power across a number of dials
     * @param _preferences Structs containing dialId & voting weights
     * @dev a staker can proportion their voting power even if they currently have zero voting power.
     * For example, they have delegated their votes.
     * When they do have voting power, their set weights will proportion their voting power. eg they undelegate.
     */
    function setVoterDialWeights(Preference[] memory _preferences) external {
        require(_preferences.length <= 16, "Maximum of 16 preferences");
        // get staker's votes
        uint256 stakerVotes = getVotes(msg.sender);

        // STEP 1 - adjust dial weighted votes from removed staker weighted votes
        _moveVotingPower(msg.sender, stakerVotes, _subtract);
        // clear the old weights as they will be added back below
        delete stakerPreferences[msg.sender];

        // STEP 2 - adjust dial weighted votes from added staker weighted votes
        uint256 newTotalWeight;
        for (uint256 i = 0; i < _preferences.length; i++) {
            require(
                _preferences[i].dialId > 0 && _preferences[i].dialId < dials.length,
                "Invalid dial id"
            );
            require(_preferences[i].weight > 0, "Must give a dial some weight");
            newTotalWeight += _preferences[i].weight;
            // Add staker's dial weight
            stakerPreferences[msg.sender][i] = _preferences[i];
        }
        if (_preferences.length < 16) {
            stakerPreferences[msg.sender][_preferences.length] = Preference(255, 0);
        }

        _moveVotingPower(msg.sender, stakerVotes, _add);

        require(newTotalWeight <= SCALE, "Imbalanced weights");
    }

    /**
     * @notice called by the staking contract when a staker has added or removed staked rewards.
     * @dev this can be called when staking, cooling down for withdraw or delegating.
     * @param from account that rewards moved from. If a mint the account will be a zero address
     * @param to account that rewards moved to. If a burn the account will be a zero address
     * @param amount the number of rewards moved including the decimal places
     */
    function moveVotingPowerHook(
        address from,
        address to,
        uint256 amount
    ) external override onlyStakingContract {
        // STEP 1 - update the total weighted votes across all dials
        // if transferring votes from or to a delegate then no need to change the total dial votes
        if (amount > 0) {
            // STEP 2 - Update the staker's dial weights
            // If burning (withdraw) or transferring delegated votes from a staker
            if (from != address(0)) {
                _moveVotingPower(from, amount, _subtract);
            }
            // If minting (staking) or transferring delegated votes to a staker
            if (to != address(0)) {
                _moveVotingPower(to, amount, _add);
            }
        }
    }

    /***************************************
                VOTING-INTERNAL
    ****************************************/

    function _moveVotingPower(
        address _voter,
        uint256 _amount,
        function(uint256, uint256) pure returns (uint256) _op
    ) internal {
        Preference[16] memory preferences = stakerPreferences[_voter];
        // Loop through preferences until dialId == 0 or until end
        for (uint256 i = 0; i < 16; i++) {
            Preference memory pref = preferences[i];
            if (pref.dialId == 255) break;
            // e.g. 5e17 * 1e18 / 1e18 * 100e18 / 1e18
            // = 50e18
            uint256 amountToChange = (pref.weight * _amount) / SCALE;
            dials[pref.dialId].weightedVotes = SafeCast.toUint128(
                _op(dials[pref.dialId].weightedVotes, amountToChange)
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
