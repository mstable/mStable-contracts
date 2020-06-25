pragma solidity 0.5.16;

import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IRewardsVault } from "../RewardsVault.sol";
import { RewardsDistributionRecipient } from "../RewardsDistributionRecipient.sol";
import { MassetHelpers } from "../../masset/shared/MassetHelpers.sol";

/**
 * @title  LockedUpRewards
 * @author Stability Labs Pty. Ltd.
 * @notice Locks up the rewards gained from the StakingRewards mechanism
 * @dev    See StakingRewards.sol for functional description
 */
contract LockedUpRewards is RewardsDistributionRecipient {

    using SafeERC20 for IERC20;

    event RewardsVaultSet(address newVault);

    // Address to which the locked up tokens should be sent
    IRewardsVault public rewardsVault;
    IERC20 public rewardsToken;

    /** @dev StakingRewardsWithLockup is a locked up version of StakingRewards */
    constructor(
        address _nexus,
        address _rewardsToken,
        IRewardsVault _rewardsVault,
        address _rewardsDistributor
    )
        internal
        RewardsDistributionRecipient(_nexus , _rewardsDistributor)
    {
        rewardsToken = IERC20(_rewardsToken);
        _setRewardsVault(_rewardsVault);
    }

    /**
     * @dev Sends senders outstanding rewards to the vault for lockup
     */
    function _lockupRewards(uint256 _rewardAmount)
        internal
    {
        rewardsVault.lockupRewards(msg.sender, _rewardAmount);
    }

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
        rewardsToken.safeApprove(address(rewardsVault), 0);
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
        emit RewardsVaultSet(address(_vault));
    }

    /**
     * @dev Allows the vault to collect the RewardsToken on users behalf
     */
    function _approveVault() internal {
        MassetHelpers.safeInfiniteApprove(address(rewardsToken), address(rewardsVault));
    }
}
