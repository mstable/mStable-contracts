pragma solidity 0.5.16;

import { IERC20WithCheckpointing } from "../shared/IERC20WithCheckpointing.sol";

contract IIncentivisedVotingLockup is IERC20WithCheckpointing {

    function getLastUserPoint(address _addr) external view returns(int128 bias, int128 slope, uint256 ts);
    function createLock(uint256 _value, uint256 _unlockTime) external;
    function withdraw() external;
    function increaseLockAmount(uint256 _value) external;
    function increaseLockLength(uint256 _unlockTime) external;
    function eject(address _user) external;
    function expireContract() external;

    function claimReward() public;
    function earned(address _account) public view returns (uint256);
}