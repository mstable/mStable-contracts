// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { SignatureVerifier } from "./deps/SignatureVerifier.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./GamifiedTokenStructs.sol";

/**
 * @title   QuestManager
 * @author  mStable
 * @notice  Centralised place to track quest management and completion status
 * @dev     VERSION: 1.0
 *          DATE:    2021-08-25
 */
contract QuestManager is Initializable, ImmutableModule {
    /// @notice Tracks the completion of each quest (user => questId => completion)
    mapping(address => mapping(uint256 => bool)) private _questCompletion;

    /// @notice List of quests, whose ID corresponds to their position in the array (from 0)
    Quest[] private _quests;
    /// @notice Timestamp at which the current season started
    uint32 public seasonEpoch;

    /// @notice A whitelisted questMaster who can administer quests including signing user quests are completed.
    address public questMaster;

    event QuestAdded(
        address questMaster,
        uint256 id,
        QuestType model,
        uint16 multiplier,
        QuestStatus status,
        uint32 expiry
    );
    event QuestComplete(address indexed user, uint256 indexed id);
    event QuestExpired(uint16 indexed id);
    event QuestSeasonEnded();

    /**
     * @param _nexus System nexus
     */
    constructor(address _nexus) ImmutableModule(_nexus) {}

    /**
     * @param _questMaster account that can sign user quests as completed
     */
    function __GamifiedToken_init(address _questMaster) internal initializer {
        seasonEpoch = SafeCast.toUint32(block.timestamp);
        questMaster = _questMaster;
    }

    /***************************************
                    QUESTS
    ****************************************/

    /**
     * @dev Called by questMasters to add a new quest to the system with default 'ACTIVE' status
     * @param _model Type of quest rewards multiplier (does it last forever or just for the season).
     * @param _multiplier Multiplier, from 1 == 1.01x to 100 == 2.00x
     * @param _expiry Timestamp at which quest expires. Note that permanent quests should still be given a timestamp.
     */
    function addQuest(
        Quest[] storage _quests,
        QuestType _model,
        uint16 _multiplier,
        uint32 _expiry
    ) external {
        require(_expiry > block.timestamp + 1 days, "Quest window too small");
        require(_multiplier > 0 && _multiplier <= 50, "Quest multiplier too large > 1.5x");

        _quests.push(
            Quest({
                model: _model,
                multiplier: _multiplier,
                status: QuestStatus.ACTIVE,
                expiry: _expiry
            })
        );

        emit QuestAdded(
            msg.sender,
            _quests.length - 1,
            _model,
            _multiplier,
            QuestStatus.ACTIVE,
            _expiry
        );
    }

    /**
     * @dev Called by questMasters to expire a quest, setting it's status as EXPIRED. After which it can
     * no longer be completed.
     * @param _id Quest ID (its position in the array)
     */
    function expireQuest(Quest[] storage _quests, uint16 _id) external {
        require(_id < _quests.length, "Quest does not exist");
        require(_quests[_id].status == QuestStatus.ACTIVE, "Quest already expired");

        _quests[_id].status = QuestStatus.EXPIRED;
        if (block.timestamp < _quests[_id].expiry) {
            _quests[_id].expiry = SafeCast.toUint32(block.timestamp);
        }

        emit QuestExpired(_id);
    }

    /**
     * @dev Called by questMasters to start a new quest season. After this, all current
     * seasonMultipliers will be reduced at the next user action (or triggered manually).
     * In order to reduce cost for any keepers, it is suggested to add quests at the start
     * of a new season to incentivise user actions.
     * A new season can only begin after 9 months has passed.
     */
    function startNewQuestSeason(uint32 seasonEpoch, Quest[] storage _quests) external {
        require(block.timestamp > (seasonEpoch + 39 weeks), "Season has not elapsed");

        uint256 len = _quests.length;
        for (uint256 i = 0; i < len; i++) {
            Quest memory quest = _quests[i];
            if (quest.model == QuestType.SEASONAL) {
                require(
                    quest.status == QuestStatus.EXPIRED || block.timestamp > quest.expiry,
                    "All seasonal quests must have expired"
                );
            }
        }

        emit QuestSeasonEnded();
    }

    /***************************************
                    USER
    ****************************************/

    /**
     * @dev Called by anyone to complete one or more quests for a staker. The user must first collect a signed message
     * from the whitelisted _signer.
     * @param _account Account that has completed the quest
     * @param _ids Quest IDs (its position in the array)
     * @param _signatures Signature from the verified _signer, containing keccak hash of account & id
     */
    function completeQuests(
        address _account,
        uint256[] memory _ids,
        bytes[] calldata _signatures
    ) external {
        uint256 len = _ids.length;
        require(len > 0 && len == _signatures.length, "Invalid args");

        Quest[] memory quests = new Quest[](len);
        for (uint256 i = 0; i < len; i++) {
            require(_validQuest(_ids[i]), "Err: Invalid Quest");
            require(!hasCompleted(_account, _ids[i]), "Err: Already Completed");
            require(
                SignatureVerifier.verify(questMaster, _account, _ids[i], _signatures[i]),
                "Err: Invalid Signature"
            );

            // store user quest has completed
            _questCompletion[_account][_ids[i]] = true;
            quests[i] = _quests[_ids[i]];

            emit QuestComplete(_account, _ids[i]);
        }

        _applyQuestMultiplier(_account, quests);
    }
}
