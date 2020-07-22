pragma solidity 0.5.16;

// Libs
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";


interface IControlledTokenWrapper {
    function deposit(address _staker, uint256 _amount) external;
    function withdraw(address _staker, uint256 _amount) external;
    function balanceOf(address _owner) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/**
 * @title  ExternalStakingTokenWrapper
 * @author Stability Labs Pty. Ltd.
 * @notice TODO
 */
contract ExternalStakingTokenWrapper is ReentrancyGuard {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    IControlledTokenWrapper public externalWrapper;

    /**
     * @dev TokenWrapper constructor
     * @param _stakingToken Wrapped token to be staked
     */
    constructor(address _stakingToken, IControlledTokenWrapper _externalWrapper) internal {
        stakingToken = IERC20(_stakingToken);
        externalWrapper = _externalWrapper;
    }

    /**
     * @dev Get the total amount of the staked token
     * @return uint256 total supply
     */
    function totalSupply()
        public
        view
        returns (uint256)
    {
        return externalWrapper.totalSupply();
    }

    /**
     * @dev Get the balance of a given account
     * @param _account User for which to retrieve balance
     */
    function balanceOf(address _account)
        public
        view
        returns (uint256)
    {
        return externalWrapper.balanceOf(_account);
    }

    /**
     * @dev Deposits a given amount of StakingToken from sender
     * @param _amount Units of StakingToken
     */
    function _stake(address _beneficiary, uint256 _amount)
        internal
        nonReentrant
    {
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
        externalWrapper.deposit(_beneficiary, _amount);
    }

    /**
     * @dev Withdraws a given stake from sender
     * @param _amount Units of StakingToken
     */
    function _withdraw(uint256 _amount)
        internal
        nonReentrant
    {
        externalWrapper.withdraw(msg.sender, _amount);
    }
}