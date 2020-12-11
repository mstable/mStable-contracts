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
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public stakingToken;
    IIncentivisedVotingLockup public stakingContract;

    uint256 private _totalBoostedSupply;
    mapping(address => uint256) private _boostedBalances;
    mapping(address => uint256) private _rawBalances;

    uint256 private constant MIN_DEPOSIT = 1e18;
    uint256 private constant MIN_VOTING_WEIGHT = 1e18;
    uint256 private constant MAX_BOOST = 15e17;
    uint256 private constant MIN_BOOST = 5e17;
    uint8 private constant BOOST_COEFF = 2;

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
        uint256 rawBalance = _rawBalances[_account];
        uint256 boostedBalance = _boostedBalances[_account];
        uint256 boost = MIN_BOOST;

        // Check whether balance is sufficient
        // is_boosted is used to minimize gas usage
        if(rawBalance > MIN_DEPOSIT) {
            uint256 votingWeight = stakingContract.balanceOf(_account);
            boost = _compute_boost(rawBalance, votingWeight);
        }

        uint256 newBoostedBalance = rawBalance.mulTruncate(boost);

        if(newBoostedBalance != boostedBalance) {
            _totalBoostedSupply = _totalBoostedSupply.sub(boostedBalance).add(newBoostedBalance);
            _boostedBalances[_account] = newBoostedBalance;
        }
    }

    /**
     * @dev Computes the boost for
     * boost = min(0.5 + 2 * voting_weight / deposit^(7/8), 1.5)
     */
    function _compute_boost(uint256 _deposit, uint256 _votingWeight)
        private
        pure
        returns (uint256)
    {
        require(_deposit >= MIN_DEPOSIT, "Requires minimum deposit value");

        if(_votingWeight == 0) return MIN_BOOST;

        // Compute balance to the power 7/8
        uint256 denominator = Root.sqrt(Root.sqrt(Root.sqrt(_deposit * 10)));
        denominator = denominator.mul(
            denominator.mul(
                denominator.mul(
                    denominator.mul(
                        denominator.mul(
                            denominator.mul(
                                denominator)))))
            );

        uint256 boost = StableMath.min(
            MIN_BOOST.add(_votingWeight.mul(BOOST_COEFF).divPrecisely(denominator)),
            MAX_BOOST
        );

        return boost;
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