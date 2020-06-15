pragma solidity 0.5.16;

import { StakingRewards } from "./StakingRewards.sol";
import { IRewardsVault } from "./RewardsVault.sol";
import { MassetHelpers } from "../masset/shared/MassetHelpers.sol";

/**
 * @title  StakingRewardsWithLockup
 * @author Stability Labs Pty. Ltd.
 * @notice Locks up the rewards gained from the StakingRewards mechanism
 * @dev    See StakingRewards.sol
 */
contract StakingRewardsWithLockup is StakingRewards {

    event RewardsVaultSet(address newVault);

    // Address to which the locked up tokens should be sent
    IRewardsVault private rewardsVault;

    /** @dev StakingRewardsWithLockup is a locked up version of StakingRewards */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _stakingToken,
        IRewardsVault _rewardsVault
    )
        public
        StakingRewards(_nexus, _rewardsToken, _stakingToken)
    {
        _setRewardsVault(_rewardsVault);
    }

    /**
     * @override
     * @dev Sends senders outstanding rewards to the vault for lockup
     */
    function claimReward()
        public
        updateReward(msg.sender)
    {
        uint256 reward = earned(msg.sender);
        if (reward > 0) {
            rewards[msg.sender] = 0;
            // @override - send to the vault instead
            // rewardsToken.safeTransfer(msg.sender, reward);
            IRewardsVault.lockupRewards(msg.sender, reward);
            emit RewardPaid(msg.sender, reward);
        }
    }

    // TODO - Need to check this works
    // /**
    //  * @dev Claims reward on behalf of another rewardee
    //  * @param _rewardee Address of the rewardee to claim
    //  */
    // function claimReward(address _rewardee)
    //     external
    //     updateReward(_rewardee)
    // {
    //     uint256 reward = earned(_rewardee);
    //     if (reward > 0) {
    //         rewards[_rewardee] = 0;
    //         // @override - send to the vault instead
    //         // rewardsToken.safeTransfer(msg.sender, reward);
    //         IRewardsVault.lockupRewards(_rewardee, reward);
    //         emit RewardPaid(_rewardee, reward);
    //     }
    // }

    /***************************************
                  VAULT
    ****************************************/

    /**
     * @dev Updates the location of the lockup vault
     * @param _newVault Address of the new vault
     */
    function changeRewardsVault(IRewardsVault _newVault)
        external
        onlyGovernor
    {
        // Set the old rewards contract allowance to 0
        IERC20(_rewardsToken).safeApprove(address(rewardsVault), 0);
        // Initialise the new vault
        _setRewardsVault(_newVault);
    }

    /**
     * @dev If for some reason the spending approval is required, re-apply
     */
    function reApproveRewardsToken()
        external
        onlyGovernor
    {
        _approveVault();
    }


    /***************************************
                  INTERNAL
    ****************************************/

    /**
     * @dev Updates the location of the lockup vault
     * @param _vault Address of the vault
     */
    function _setRewardsVault(IRewardsVault _vault) internal {
        require(address(_vault) != address(0), "Null vault address supplied");
        require(address(_vault) != address(rewardsVault), "Vault update not required");
        rewardsVault = _vault;
        _approveVault();
        emit RewardsVaultSet(_vault);
    }

    /**
     * @dev Allows the vault to collect the RewardsToken on users behalf
     */
    function _approveVault() internal {
        MassetHelpers.safeInfiniteApprove(address(rewardsToken), address(rewardsVault));
    }
}
