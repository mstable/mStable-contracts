pragma solidity 0.5.16;

// Internal
import { IIncentivisedVotingLockup } from "../interfaces/IIncentivisedVotingLockup.sol";

// Libs
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";


contract BoostedTokenWrapper is ReentrancyGuard {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    IIncentivisedVotingLockup public stakingContract;

    uint256 private _totalBoostedSupply;
    mapping(address => uint256) private _boostedBalances;
    mapping(address => uint256) private _rawBalances;

    /**
     * @dev TokenWrapper constructor
     * @param _stakingToken Wrapped token to be staked
     */
    constructor(address _stakingToken, address _stakingContract) internal {
        stakingToken = IERC20(_stakingToken);
        stakingContract = IIncentivisedVotingLockup(_stakingContract);
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
        return _totalBoostedSupply;
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
        return _boostedBalances[_account];
    }

    /**
     * @dev Get the balance of a given account
     * @param _account User for which to retrieve balance
     */
    function rawBalanceOf(address _account)
        public
        view
        returns (uint256)
    {
        return _rawBalances[_account];
    }

    /**
     * @dev Deposits a given amount of StakingToken from sender
     * @param _amount Units of StakingToken
     */
    function _stakeRaw(address _beneficiary, uint256 _amount)
        internal
        nonReentrant
    {
        _rawBalances[_beneficiary] = _rawBalances[_beneficiary].add(_amount);
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
    }

    /**
     * @dev Withdraws a given stake from sender
     * @param _amount Units of StakingToken
     */
    function _withdrawRaw(uint256 _amount)
        internal
        nonReentrant
    {
        _rawBalances[msg.sender] = _rawBalances[msg.sender].sub(_amount);
        stakingToken.safeTransfer(msg.sender, _amount);
    }

    function _setBoost(address _account)
        internal
    {
        uint256 oldBoost = _boostedBalances[_account];
        uint256 newBoost = _rawBalances[_account].add(1);
        _totalBoostedSupply = _totalBoostedSupply.sub(oldBoost).add(newBoost);
        _boostedBalances[_account] = newBoost;
        // boost = stakingContract
        // decrease old total supply
        // decrease old boosted amount
        // calculate new boost
        // add to total supply
        // add to old boost
    }
}