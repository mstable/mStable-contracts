// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IGovernanceHook } from "../governance/staking/interfaces/IGovernanceHook.sol";
import { IRewardsDistributionRecipient } from "../interfaces/IRewardsDistributionRecipient.sol";
import { IVotes } from "../interfaces/IVotes.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

struct HistoricVotes {
    uint128 weightedVotes;
    // The start of the distribution period in seconds divided by 604,800 seconds in a week
    uint32 epoch;
}

struct DialData {
    // If true, no rewards are distributed to the dial recipient
    bool disabled;
    // If true, `notifyRewardAmount` on the recipient contract is called
    bool notify;
    // Cap on distribution % where 1% = 1
    uint8 cap;
    // Dial rewards that are waiting to be distributed to recipient
    uint96 balance;
    // Account rewards are distributed to
    address recipient;
    // list of weighted votes in each distribution period. 1 slot
    HistoricVotes[] voteHistory;
}

struct Preference {
    uint8 dialId;
    uint8 weight;
}

struct VoterPreferences {
    Preference[16] dialWeights;
    uint128 votesCast;
    uint32 lastSourcePoke;
}

struct TopLevelConfig {
    int256 A;
    int256 B;
    int256 C;
    int256 D;
    uint128 EPOCHS;
}

struct EpochHistory {
    // First weekly epoch of this contract.
    uint32 startEpoch;
    // The last weekly epoch to have rewards distributed.
    uint32 lastEpoch;
}

/**
 * @title  EmissionsController
 * @author mStable
 * @notice Calculates the weekly rewards to be sent to each dial based on governance votes.
 * @dev    VERSION: 1.0
 *         DATE:    2021-10-28
 *         An epoch is the number of weeks since 1 Jan 1970. The week starts on Thursday 00:00 UTC.
 *         epoch = start of the distribution period in seconds divided by 604,800 seconds in a week
 */
contract EmissionsController is IGovernanceHook, Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    // CONST

    /// @notice Minimum time between distributions.
    uint32 constant DISTRIBUTION_PERIOD = 1 weeks;
    /// @notice Scale of dial weights. 200 = 100%, 2 = 1%, 1 = 0.5%
    uint256 constant SCALE = 200;
    /// @notice Immutable emissions config, where 1 = 1
    int256 immutable A;
    int256 immutable B;
    int256 immutable C;
    int256 immutable D;
    uint128 immutable EPOCHS;

    // HIGH LEVEL EMISSION

    /// @notice Epoch history in storage
    EpochHistory public epochs;
    /// @notice Address of rewards token. ie MTA token
    IERC20 public immutable rewardToken;

    // VOTING

    /// @notice Flags the timestamp that a given staking contract was added
    mapping(address => uint32) public stakingContractAddTime;
    /// @notice List of staking contract addresses.
    IVotes[] public stakingContracts;

    /// @notice List of dial data including weightedVotes, rewards balance, recipient contract and disabled flag.
    DialData[] public dials;
    /// @notice Mapping of staker addresses to an list of voter dial weights.
    /// @dev    The sum of the weights for each staker must not be greater than SCALE = 10000.
    ///         A user can issue a subset of their voting power. eg only 20% of their voting power.
    ///         A user can not issue more than 100% of their voting power across dials.
    mapping(address => VoterPreferences) public voterPreferences;

    // EVENTS

    event AddedDial(uint256 indexed id, address indexed recipient);
    event UpdatedDial(uint256 indexed id, bool diabled);
    event AddStakingContract(address indexed stakingContract);

    event PeriodRewards(uint256[] amounts);
    event DonatedRewards(uint256 indexed dialId, uint256 amount);
    event DistributedReward(uint256 indexed dialId, uint256 amount);

    event PreferencesChanged(address indexed voter, Preference[] preferences);
    event VotesCast(address from, address to, uint256 amount);

    /***************************************
                    INIT
    ****************************************/

    /**
     * @notice Recipient is a module, governed by mStable governance
     * @param _nexus System nexus that resolves module addresses
     * @param _rewardToken token that rewards are distributed in. eg MTA
     */
    constructor(
        address _nexus,
        address _rewardToken,
        TopLevelConfig memory _config
    ) ImmutableModule(_nexus) {
        require(_rewardToken != address(0), "Reward token address is zero");
        rewardToken = IERC20(_rewardToken);
        A = _config.A * 1e12;
        B = _config.B * 1e12;
        C = _config.C * 1e12;
        D = _config.D * 1e12;
        EPOCHS = _config.EPOCHS * 1e6;
    }

    /**
     * @dev Initialize function to configure the first dials.
     * @param _recipients list of dial contract addressess that can receive rewards.
     * @param _notifies list of dial notify flags. If true, `notifyRewardAmount` is called in the `distributeRewards` function.
     * @param _stakingContracts two staking contract with voting power.
     * @dev all recipient contracts need to implement the `IRewardsDistributionRecipient` interface.
     */
    function initialize(
        address[] memory _recipients,
        uint8[] memory _caps,
        bool[] memory _notifies,
        address[] memory _stakingContracts,
        uint128 _totalRewards
    ) external initializer {
        uint256 len = _recipients.length;
        require(_notifies.length == len && _caps.length == len, "Initialize args mistmatch");

        // 1.0 - Add each of the dials
        for (uint256 i = 0; i < len; i++) {
            _addDial(_recipients[i], _caps[i], _notifies[i]);
        }

        // 2.0 - Set the last epoch storage variable to the immutable start epoch
        //       Set the weekly epoch this contract starts distributions which will be 1 - 2 week after deployment.
        uint32 startEpoch = SafeCast.toUint32((block.timestamp + 1 weeks) / DISTRIBUTION_PERIOD);
        epochs = EpochHistory({ startEpoch: startEpoch, lastEpoch: startEpoch });

        rewardToken.safeTransferFrom(msg.sender, address(this), _totalRewards);

        // 3.0 - Initialize the staking contracts
        for (uint256 i = 0; i < _stakingContracts.length; i++) {
            _addStakingContract(_stakingContracts[i]);
        }
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
        // For each configured staking contract
        for (uint256 i = 0; i < stakingContracts.length; i++) {
            votingPower += stakingContracts[i].getVotes(account);
        }
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @notice Adds a new dial that can be voted on to receive weekly rewards.
     * @param _recipient Address of the contract that will receive rewards.
     * @param _cap Cap where 0 = uncapped and 10 = 10%.
     * @param _notify If true, `notifyRewardAmount` is called in the `distributeRewards` function.
     */
    function addDial(
        address _recipient,
        uint8 _cap,
        bool _notify
    ) external onlyGovernor {
        _addDial(_recipient, _cap, _notify);
    }

    function _addDial(
        address _recipient,
        uint8 _cap,
        bool _notify
    ) internal {
        require(_recipient != address(0), "Dial address is zero");
        require(_cap < 100, "Invalid cap");

        uint256 len = dials.length;
        require(len < 254, "Max dial count reached");
        for (uint256 i = 0; i < len; i++) {
            require(dials[i].recipient != _recipient, "Dial already exists");
        }

        dials.push();
        DialData storage newDialData = dials[len];
        newDialData.recipient = _recipient;
        newDialData.notify = _notify;
        newDialData.cap = _cap;
        newDialData.voteHistory.push(
            HistoricVotes({ weightedVotes: 0, epoch: _epoch(block.timestamp) })
        );

        emit AddedDial(len, _recipient);
    }

    /**
     * @notice Updates a dials recipient contract and/or disabled flag.
     * @param _dialId Dial identifier which is the index of the dials array.
     * @param _disabled If true, no rewards will be distributed to this dial.
     */
    function updateDial(uint256 _dialId, bool _disabled) external onlyGovernor {
        require(_dialId < dials.length, "Invalid dial id");

        dials[_dialId].disabled = _disabled;

        emit UpdatedDial(_dialId, _disabled);
    }

    /**
     * @notice Adds a new contract to the list of approved staking contracts.
     * @param _stakingContract address of the new staking contracts.
     */
    function addStakingContract(address _stakingContract) external onlyGovernor {
        _addStakingContract(_stakingContract);
    }

    function _addStakingContract(address _stakingContract) internal {
        require(_stakingContract != address(0), "Staking contract address is zero");

        stakingContractAddTime[_stakingContract] = SafeCast.toUint32(block.timestamp);
        stakingContracts.push(IVotes(_stakingContract));

        emit AddStakingContract(_stakingContract);
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
            require(dialId < dials.length, "Invalid dial id");

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
     * @notice Calculates the rewards to be distributed to each dial for the next weekly period to be processed.
     *         The period being processed has to be completed. Any diabled dials will be ignored and rewards
     *         redistributed proportionally to the dials that have not been disabled. Any updates to the weights
     *         after the period finished will be ignored.
     */
    function calculateRewards() external {
        // 1 - Calculate amount of rewards to distribute this week
        uint32 epoch = SafeCast.toUint32(block.timestamp) / DISTRIBUTION_PERIOD;
        require(epoch > epochs.lastEpoch, "Must wait for new period");
        //     Update storage with new last epoch
        epochs.lastEpoch = epoch;
        uint256 emissionForEpoch = topLineEmission(epoch);

        // 2.0 - Calculate the total amount of dial votes ignoring any disabled dials
        uint256 totalDialVotes;
        uint256 dialLen = dials.length;
        uint256[] memory dialWeightedVotes = new uint256[](dialLen);
        for (uint256 i = 0; i < dialLen; i++) {
            DialData memory dialData = dials[i];
            if (dialData.disabled) continue;

            // Get the relevant votes for the dial. Possibilities:
            //   - No new votes cast in period, therefore relevant votes are at pos len - 1
            //   - Votes already cast in period, therefore relevant is at pos len - 2
            uint256 end = dialData.voteHistory.length - 1;
            HistoricVotes memory latestVote = dialData.voteHistory[end];
            if (latestVote.epoch < epoch) {
                dialWeightedVotes[i] = latestVote.weightedVotes;
                totalDialVotes += latestVote.weightedVotes;
                // Create a new weighted votes for the current distribution period
                dials[i].voteHistory.push(
                    HistoricVotes({
                        weightedVotes: latestVote.weightedVotes,
                        epoch: SafeCast.toUint32(epoch)
                    })
                );
            } else if (latestVote.epoch == epoch && end > 0) {
                uint256 votes = dialData.voteHistory[end - 1].weightedVotes;
                dialWeightedVotes[i] = votes;
                totalDialVotes += votes;
            }
        }

        // 3.0 - Deal with the capped dials
        uint256[] memory distributionAmounts = new uint256[](dialLen);
        uint256 postCappedVotes = totalDialVotes;
        uint256 postCappedEmission = emissionForEpoch;
        for (uint256 k = 0; k < dialLen; k++) {
            DialData memory dialData = dials[k];
            // 3.1 - If the dial has a cap and isn't disabled, check if it's over the threshold
            if (dialData.cap > 0 && !dialData.disabled) {
                uint256 maxVotes = (dialData.cap * totalDialVotes) / 100;
                if (dialWeightedVotes[k] > maxVotes) {
                    // Calculate amount of rewards for the dial & set storage
                    distributionAmounts[k] = (dialData.cap * emissionForEpoch) / 100;
                    dials[k].balance += SafeCast.toUint96(distributionAmounts[k]);

                    // Calculate amount of rewards for the dial & set storage
                    postCappedVotes -= dialWeightedVotes[k];
                    postCappedEmission -= distributionAmounts[k];
                    dialWeightedVotes[k] = 0;
                }
            }
        }

        // 4.0 - Calculate the distribution amounts for each dial
        for (uint256 l = 0; l < dialLen; l++) {
            // Skip dial if no votes or disabled
            if (dialWeightedVotes[l] == 0) {
                continue;
            }

            // Calculate amount of rewards for the dial & set storage
            distributionAmounts[l] = (dialWeightedVotes[l] * postCappedEmission) / postCappedVotes;
            dials[l].balance += SafeCast.toUint96(distributionAmounts[l]);
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

            // 1.0 - Get the dial's reward balance
            if (dialData.balance == 0) {
                continue;
            }
            // 2.0 - Reset the balance in storage back to 0
            dials[_dialIds[i]].balance = 0;

            // 3.0 - Send the rewards the to the dial recipient
            rewardToken.safeTransfer(dialData.recipient, dialData.balance);

            // 4.0 - Notify the dial of the new rewards if configured to
            //       Only after successful transer tx
            if (dialData.notify) {
                IRewardsDistributionRecipient(dialData.recipient).notifyRewardAmount(
                    dialData.balance
                );
            }

            emit DistributedReward(_dialIds[i], dialData.balance);
        }
    }

    /**
     * @dev Calculates top line distribution amount for the current epoch as per the polynomial
     *                  (f(x)=A*(x/div)^3+B*(x/div)^2+C*(x/div)+D)
     * NB: Values are effectively scaled to 1e12 to avoid integer overflow on pow
     * @param epoch Index of the epoch to look up
     * @return emissionForEpoch Units of MTA to be distributed at this epoch
     */
    function topLineEmission(uint32 epoch) public view returns (uint256 emissionForEpoch) {
        // e.g. week 1, A = -166000e12, B = 180000e12, C = -180000e12, D = 166000e12
        // e.g. epochDelta = 1e18
        uint128 epochDelta = (epoch - epochs.startEpoch) * 1e18;
        // e.g. x = 1e18 / 312e6 = 3205128205
        int256 x = SafeCast.toInt256(epochDelta / EPOCHS);
        emissionForEpoch =
            SafeCast.toUint256(
                ((A * (x**3)) / 1e36) + // e.g. -166000e12 * (3205128205 ^ 3) / 1e36 =   -5465681315
                    ((B * (x**2)) / 1e24) + // e.g.  180000e12 * (3205128205 ^ 2) / 1e24.0 = 1849112425887
                    ((C * (x)) / 1e12) + // e.g. -180000e12 * 3205128205 / 1e12 =    -576923076900000
                    D // e.g.                                   166000000000000000
            ) *
            1e6; // e.g. SUM = 1,6542492e17 * 1e6 = 165424e18
    }

    /***************************************
                VOTING-EXTERNAL
    ****************************************/

    function pokeSources(address _voter) external {
        uint256 votesCast = voterPreferences[_voter].votesCast;
        _moveVotingPower(_voter, getVotes(_voter) - votesCast, _add);
        voterPreferences[_voter].lastSourcePoke = SafeCast.toUint32(block.timestamp);
    }

    /**
     * @notice Allows a staker to proportion their voting power across a number of dials.
     * @param _preferences Structs containing dialId & voting weights.
     * @dev A staker can proportion their voting power even if they currently have zero voting power.
     *      For example, they have delegated their votes.
     *      When they do have voting power, their set weights will proportion their voting power. eg they undelegate.
     */
    function setVoterDialWeights(Preference[] memory _preferences) external {
        require(_preferences.length <= 16, "Maximum of 16 preferences");

        // 0.0 - Get staker's previous total votes cast
        uint256 votesCast = voterPreferences[msg.sender].votesCast;

        // 1.0 - Adjust dial weighted votes from removed staker weighted votes
        _moveVotingPower(msg.sender, votesCast, _subtract);
        //       Clear the old weights as they will be added back below
        delete voterPreferences[msg.sender];

        // 2.0 - Adjust dial weighted votes from added staker weighted votes
        uint256 newTotalWeight;
        for (uint256 i = 0; i < _preferences.length; i++) {
            require(_preferences[i].dialId < dials.length, "Invalid dial id");
            require(_preferences[i].weight > 0, "Must give a dial some weight");
            newTotalWeight += _preferences[i].weight;
            //  Add staker's dial weight
            voterPreferences[msg.sender].dialWeights[i] = _preferences[i];
        }
        if (_preferences.length < 16) {
            voterPreferences[msg.sender].dialWeights[_preferences.length] = Preference(255, 0);
        }
        require(newTotalWeight <= SCALE, "Imbalanced weights");
        _moveVotingPower(msg.sender, getVotes(msg.sender), _add);
        voterPreferences[msg.sender].lastSourcePoke = SafeCast.toUint32(block.timestamp);

        emit PreferencesChanged(msg.sender, _preferences);
    }

    /**
     * @notice called by the staking contracts when a staker has added or removed staked rewards.
     * @dev this can be called when staking, cooling down for withdraw or delegating.
     * @param from account that rewards moved from. If a mint the account will be a zero address.
     * @param to account that rewards moved to. If a burn the account will be a zero address.
     * @param amount the number of rewards moved including the decimal places.
     */
    function moveVotingPowerHook(
        address from,
        address to,
        uint256 amount
    ) external override {
        if (amount > 0) {
            uint32 addTime = stakingContractAddTime[msg.sender];
            require(addTime > 0, "Caller must be staking contract");

            // If burning (withdraw) or transferring delegated votes from a staker
            if (from != address(0) && voterPreferences[from].lastSourcePoke > 0) {
                require(
                    voterPreferences[from].lastSourcePoke > addTime,
                    "Must init new contract bal"
                );
                _moveVotingPower(from, amount, _subtract);
            }
            // If minting (staking) or transferring delegated votes to a staker
            if (to != address(0) && voterPreferences[to].lastSourcePoke > 0) {
                require(
                    voterPreferences[to].lastSourcePoke > addTime,
                    "Must init new contract bal"
                );
                _moveVotingPower(to, amount, _add);
            }

            emit VotesCast(from, to, amount);
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
        // 0.0 - Get preferences and epoch data
        VoterPreferences memory preferences = voterPreferences[_voter];
        uint32 currentEpoch = _epoch(block.timestamp);
        voterPreferences[_voter].votesCast = SafeCast.toUint128(
            _op(preferences.votesCast, _amount)
        );

        // 1.0 - Loop through preferences until dialId == 255 or until end
        for (uint256 i = 0; i < 16; i++) {
            Preference memory pref = preferences.dialWeights[i];
            if (pref.dialId == 255) break;

            // 1.1 - Scale the vote by dial weight
            //       e.g. 5e17 * 1e18 / 1e18 * 100e18 / 1e18 = 50e18
            uint256 amountToChange = (pref.weight * _amount) / SCALE;

            // 1.2 - Fetch voting history for this dial
            HistoricVotes[] storage voteHistory = dials[pref.dialId].voteHistory;
            uint256 len = voteHistory.length;
            HistoricVotes storage latestHistoricVotes = voteHistory[len - 1];

            // 1.3 - Determine new votes cast for dial
            uint128 newWeightedVotes = SafeCast.toUint128(
                _op(latestHistoricVotes.weightedVotes, amountToChange)
            );

            // 1.4 - Update dial vote count. If first vote in new epoch, create new entry
            if (latestHistoricVotes.epoch < currentEpoch) {
                // Add a new weighted votes epoch for the dial
                voteHistory.push(
                    HistoricVotes({ weightedVotes: newWeightedVotes, epoch: currentEpoch })
                );
            } else {
                // Epoch already exists for this dial so just update the dial's weighted votes
                latestHistoricVotes.weightedVotes = newWeightedVotes;
            }
        }
    }

    /**
     * @notice returns the epoch a UNIX timestamp in seconds is in.
     * This is the number of weeks since 1 Jan 1970. ie the timestamp / 604800 seconds in a week.
     * @dev each week starts on Thursday 00:00 UTC.
     * @param timestamp UNIX time in seconds.
     * @return epoch the number of weeks since 1 Jan 1970
     */
    function _epoch(uint256 timestamp) internal pure returns (uint32 epoch) {
        epoch = SafeCast.toUint32(timestamp) / DISTRIBUTION_PERIOD;
    }

    function _add(uint256 a, uint256 b) private pure returns (uint256) {
        return a + b;
    }

    function _subtract(uint256 a, uint256 b) private pure returns (uint256) {
        return a - b;
    }
}
