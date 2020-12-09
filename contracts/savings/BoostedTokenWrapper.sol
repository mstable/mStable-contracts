pragma solidity 0.5.16;

// Internal
import { IIncentivisedVotingLockup } from "../interfaces/IIncentivisedVotingLockup.sol";

// Libs
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { StableMath } from "../shared/StableMath.sol";
import { Root } from "../shared/Root.sol";


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

    /**
     * @dev Updates the boost for the given address according to the formula
     * boost = min(0.5 + 2 * vMTA_balance / ymUSD_locked^(7/8), 1.5)
     * @param _account User for which to update the boost
     */
    function _setBoost(address _account)
        internal
    {
        uint256 vMTABalance = stakingContract.balanceOf(_account);

        // The following lines should compute locked ymUSD to the power 7/8
        uint256 denominator = Root.sqrt(Root.sqrt(Root.sqrt(_rawBalances[_account])));
        denominator = denominator.mul(
            denominator.mul(
                denominator.mul(
                    denominator.mul(
                        denominator.mul(
                            denominator.mul(
                                denominator))))));

        uint256 maxBoost = StableMath.divPrecisely(3, 2);

        uint256 boost = StableMath.min(
            StableMath.divPrecisely(1, 2)
            + StableMath.divPrecisely(vMTABalance.mul(2), denominator),
            maxBoost);

        uint256 oldBoostedBalance = _boostedBalances[_account];
        uint256 newBoostedBalance = StableMath.mulTruncate(_rawBalances[_account], boost);
        _totalBoostedSupply = _totalBoostedSupply.sub(oldBoostedBalance).add(newBoostedBalance);
        _boostedBalances[_account] = newBoostedBalance;
    }

    /**
     * @dev Read the boost for the given address
     * @param _account User for which to return the boost
     */
    function getBoost(address _account)
        public
        view
        returns (uint256)
    {
        return StableMath.divPrecisely(_boostedBalances[_account], _rawBalances[_account]);
    }

}