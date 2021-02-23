// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

// Internal
import { IIncentivisedVotingLockup } from "../interfaces/IIncentivisedVotingLockup.sol";

// Libs
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";
import { StableMath } from "../shared/StableMath.sol";
import { Root } from "../shared/Root.sol";

/**
 * @title  BoostedTokenWrapper
 * @author mStable
 * @notice Wrapper to facilitate tracking of staked balances, applying a boost
 * @dev    Forked from rewards/staking/StakingTokenWrapper.sol
 *         Changes:
 *          - Adding `_boostedBalances` and `_totalBoostedSupply`
 *          - Implemting of a `_setBoost` hook to calculate/apply a users boost
 */
contract BoostedTokenWrapper is InitializableReentrancyGuard {
    using StableMath for uint256;
    using SafeERC20 for IERC20;

    IERC20 public immutable stakingToken;
    // mStable MTA Staking contract
    IIncentivisedVotingLockup public immutable stakingContract;

    uint256 private _totalBoostedSupply;
    mapping(address => uint256) private _boostedBalances;
    mapping(address => uint256) private _rawBalances;

    // Vars for use in the boost calculations
    uint256 private constant MIN_DEPOSIT = 1e18;
    uint256 private constant MAX_BOOST = 15e17;
    uint256 private constant MIN_BOOST = 5e17;
    uint8 private constant BOOST_COEFF = 60;

    uint256 private immutable priceCoeff;

    /**
     * @dev TokenWrapper constructor
     * @param _stakingToken Wrapped token to be staked
     * @param _stakingContract mStable MTA Staking contract
     * @param _priceCoeff Rough price of a given LP token, to be used in boost calculations, where $1 = 1e18
     */
    constructor(
        address _stakingToken,
        address _stakingContract,
        uint256 _priceCoeff
    ) {
        stakingToken = IERC20(_stakingToken);
        stakingContract = IIncentivisedVotingLockup(_stakingContract);
        priceCoeff = _priceCoeff;
    }

    function _initialize() internal {
        _initializeReentrancyGuard();
    }

    /**
     * @dev Get the total boosted amount
     * @return uint256 total supply
     */
    function totalSupply() public view returns (uint256) {
        return _totalBoostedSupply;
    }

    /**
     * @dev Get the boosted balance of a given account
     * @param _account User for which to retrieve balance
     */
    function balanceOf(address _account) public view returns (uint256) {
        return _boostedBalances[_account];
    }

    /**
     * @dev Get the RAW balance of a given account
     * @param _account User for which to retrieve balance
     */
    function rawBalanceOf(address _account) public view returns (uint256) {
        return _rawBalances[_account];
    }

    /**
     * @dev Read the boost for the given address
     * @param _account User for which to return the boost
     * @return boost where 1x == 1e18
     */
    function getBoost(address _account) public view returns (uint256) {
        return balanceOf(_account).divPrecisely(rawBalanceOf(_account));
    }

    /**
     * @dev Deposits a given amount of StakingToken from sender
     * @param _amount Units of StakingToken
     */
    function _stakeRaw(address _beneficiary, uint256 _amount) internal nonReentrant {
        _rawBalances[_beneficiary] += _amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), _amount);
    }

    /**
     * @dev Withdraws a given stake from sender
     * @param _amount Units of StakingToken
     */
    function _withdrawRaw(uint256 _amount) internal nonReentrant {
        _rawBalances[msg.sender] -= _amount;
        stakingToken.safeTransfer(msg.sender, _amount);
    }

    /**
     * @dev Updates the boost for the given address according to the formula
     * boost = min(0.5 + c * vMTA_balance / imUSD_locked^(7/8), 1.5)
     * If rawBalance <= MIN_DEPOSIT, boost is 0
     * @param _account User for which to update the boost
     */
    function _setBoost(address _account) internal {
        uint256 rawBalance = _rawBalances[_account];
        uint256 boostedBalance = _boostedBalances[_account];
        uint256 boost = MIN_BOOST;

        // Check whether balance is sufficient
        // is_boosted is used to minimize gas usage
        uint256 scaledBalance = (rawBalance * priceCoeff) / 1e18;
        if (scaledBalance >= MIN_DEPOSIT) {
            uint256 votingWeight = stakingContract.balanceOf(_account);
            boost = _computeBoost(scaledBalance, votingWeight);
        }

        uint256 newBoostedBalance = rawBalance.mulTruncate(boost);

        if (newBoostedBalance != boostedBalance) {
            _totalBoostedSupply = _totalBoostedSupply - boostedBalance + newBoostedBalance;
            _boostedBalances[_account] = newBoostedBalance;
        }
    }

    /**
     * @dev Computes the boost for
     * boost = min(0.5 + c * voting_weight / deposit^(7/8), 1.5)
     * @param _scaledDeposit deposit amount in terms of USD
     */
    function _computeBoost(uint256 _scaledDeposit, uint256 _votingWeight)
        private
        pure
        returns (uint256 boost)
    {
        if (_votingWeight == 0) return MIN_BOOST;

        // Compute balance to the power 7/8
        // if price is     $0.10, do sqrt(_deposit * 1e5)
        // if price is     $1.00, do sqrt(_deposit * 1e6)
        // if price is $10000.00, do sqrt(_deposit * 1e9)
        uint256 denominator = Root.sqrt(Root.sqrt(Root.sqrt(_scaledDeposit * 1e6)));
        denominator =
            denominator *
            denominator *
            denominator *
            denominator *
            denominator *
            denominator *
            denominator;
        denominator /= 1e3;
        boost = (((_votingWeight * BOOST_COEFF) / 10) * 1e18) / denominator;
        boost = StableMath.min(MIN_BOOST + boost, MAX_BOOST);
    }
}
