// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

/**
 * @dev Alchemix Staking Pool
 * Source: https://github.com/alchemix-finance/alchemix-protocol/blob/master/contracts/StakingPools.sol
 */
interface IAlchemixStakingPools {
    function claim(uint256 _poolId) external;

    function deposit(uint256 _poolId, uint256 _depositAmount) external;

    function exit(uint256 _poolId) external;

    function getStakeTotalDeposited(address _account, uint256 _poolId)
        external
        view
        returns (uint256);

    function getStakeTotalUnclaimed(address _account, uint256 _poolId)
        external
        view
        returns (uint256);

    function getPoolRewardRate(uint256 _poolId) external view returns (uint256);

    function getPoolRewardWeight(uint256 _poolId) external view returns (uint256);

    function getPoolToken(uint256 _poolId) external view returns (address);

    function reward() external view returns (address);

    function tokenPoolIds(address _token) external view returns (uint256);

    function withdraw(uint256 _poolId, uint256 _withdrawAmount) external;
}
