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

    uint256 private constant MIN_DEPOSIT = 1e18;
    uint256 private constant MIN_VOTING_WEIGHT = 1e18;
    uint256 private constant MAX_BOOST = 1e18 / 2;
    uint256 private constant MIN_BOOST = 1e18 * 3 / 2;
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
        uint256 balance = _rawBalances[_account];
        uint256 boostedBalance = _boostedBalances[_account];
        uint256 votingWeight;
        uint256 boost;
        bool is_boosted = true;

        // Check whether balance is sufficient
        // is_boosted is used to minimize gas usage
        if(balance < MIN_DEPOSIT) {
            is_boosted = false;
        }

        // Check whether voting weight balance is sufficient
        if(is_boosted) {
            votingWeight = stakingContract.balanceOf(_account);
            if(votingWeight < MIN_VOTING_WEIGHT) {
                is_boosted = false;
            }
        }

        if(is_boosted) {
            boost = _compute_boost(balance, votingWeight);
        } else {
            boost = MIN_BOOST;
        }

        uint256 newBoostedBalance = StableMath.mulTruncate(balance, boost);

        if(newBoostedBalance != boostedBalance) {
            _totalBoostedSupply = _totalBoostedSupply.sub(boostedBalance).add(newBoostedBalance);
            _boostedBalances[_account] = newBoostedBalance;
        }
    }

    /**
     * @dev Computes the boost for
     * boost = min(0.5 + 2 * voting_weight / deposit^(7/8), 1.5)
     * @param _account User for which to update the boost
     */
    function _compute_boost(uint256 _deposit, uint256 _votingWeight)
        private
        pure
        returns (uint256)
    {
        require(_deposit >= MIN_DEPOSIT, "Requires minimum deposit value.");
        require(_votingWeight >= MIN_VOTING_WEIGHT, "Requires minimum voting weight.");

        // Compute balance to the power 7/8
        uint256 denominator = Root.sqrt(Root.sqrt(Root.sqrt(_deposit)));
        denominator = denominator.mul(
            denominator.mul(
                denominator.mul(
                    denominator.mul(
                        denominator.mul(
                            denominator.mul(
                                denominator))))));

        uint256 boost = StableMath.min(
            MIN_BOOST + StableMath.divPrecisely(_votingWeight.mul(BOOST_COEFF), denominator),
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