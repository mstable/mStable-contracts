// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { Balance, Checkpoint, Quest, QuestType, QuestStatus } from "./GamifiedTokenStructs.sol";
// import { SignatureVerifier } from "./deps/SignatureVerifier.sol";

 /**
 * @title   GamifiedManager
 * @author  mStable
 * @notice  library to reduce the size of the GamifiedToken contract.
 * @dev     VERSION: 1.0
 *          DATE:    2021-08-11
 */
library GamifiedManager {

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
}
