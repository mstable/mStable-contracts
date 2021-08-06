// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import "../GamifiedTokenStructs.sol";

interface IStakedToken {
    /** USER */
    function stake(uint256 _amount) external;

    function stake(uint256 _amount, address _delegatee) external;

    function withdraw(
        uint256 _amount,
        address _recipient,
        bool _amountIncludesFee,
        bool _exitCooldown
    ) external;

    function startCooldown(uint256 _percentage) external;

    // TODO - these can't be added to the base interface unless used with `super.delegate()`
    // function delegate(address delegatee) external;
    // function completeQuest(
    //     address _account,
    //     uint256 _id,
    //     bytes calldata _signature
    // ) external;
    // function reviewTimestamp(address _account) external;
    // function claimReward(address _to) external;
    // function claimReward() external;

    /** VIEWS */
    // function getVotes(address account) external view returns (uint256);
    // function getPastVotes(address account, uint256 blockNumber) external view returns (uint256);
    // function getPastTotalSupply(uint256 blockNumber) external view returns (uint256);
    // function balanceData(address _account) external view returns (Balance memory);
    // function getQuest(uint256 _id) external view returns (Quest memory);
    // function getQuestCompletion(address _account, uint256 _id) external view returns (bool);

    /** ADMIN */
    // function setGovernanceHook(address _newHook) external;
    // function addQuest(
    //     QuestType _model,
    //     uint16 _multiplier,
    //     uint32 _expiry
    // ) external;
    // function expireQuest(uint16 _id) external;
    // function startNewQuestSeason() external;
    // function notifyRewardAmount(uint256 _reward) external;
}
