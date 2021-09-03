// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Internal
import { IBoostDirector } from "../../interfaces/IBoostDirector.sol";

// Libs
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";
import { StableMath } from "../../shared/StableMath.sol";
import { Root } from "../../shared/Root.sol";

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

    event Transfer(address indexed from, address indexed to, uint256 value);

    string private _name;
    string private _symbol;

    IERC20 public immutable stakingToken;
    IBoostDirector public immutable boostDirector;

    uint256 private _totalBoostedSupply;
    mapping(address => uint256) private _boostedBalances;
    mapping(address => uint256) private _rawBalances;

    // Vars for use in the boost calculations
    uint256 private constant MIN_DEPOSIT = 1e18;
    uint256 private constant MAX_VMTA = 600000e18;
    uint256 private constant MAX_BOOST = 3e18;
    uint256 private constant MIN_BOOST = 1e18;
    uint256 private constant FLOOR = 98e16;
    uint256 public immutable boostCoeff; // scaled by 10
    uint256 public immutable priceCoeff;

    /**
     * @dev TokenWrapper constructor
     * @param _stakingToken Wrapped token to be staked
     * @param _boostDirector vMTA boost director
     * @param _priceCoeff Rough price of a given LP token, to be used in boost calculations, where $1 = 1e18
     * @param _boostCoeff  Boost coefficent using the the boost formula
     */
    constructor(
        address _stakingToken,
        address _boostDirector,
        uint256 _priceCoeff,
        uint256 _boostCoeff
    ) {
        stakingToken = IERC20(_stakingToken);
        boostDirector = IBoostDirector(_boostDirector);
        priceCoeff = _priceCoeff;
        boostCoeff = _boostCoeff;
    }

    /**
     * @param _nameArg token name. eg imUSD Vault or GUSD Feeder Pool Vault
     * @param _symbolArg token symbol. eg v-imUSD or v-fPmUSD/GUSD
     */
    function _initialize(string memory _nameArg, string memory _symbolArg) internal {
        _initializeReentrancyGuard();
        _name = _nameArg;
        _symbol = _symbolArg;
    }

    function name() public view virtual returns (string memory) {
        return _name;
    }

    function symbol() public view virtual returns (string memory) {
        return _symbol;
    }

    function decimals() public view virtual returns (uint8) {
        return 18;
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
            uint256 votingWeight = boostDirector.getBalance(_account);
            boost = _computeBoost(scaledBalance, votingWeight);
        }

        uint256 newBoostedBalance = rawBalance.mulTruncate(boost);

        if (newBoostedBalance != boostedBalance) {
            _totalBoostedSupply = _totalBoostedSupply - boostedBalance + newBoostedBalance;
            _boostedBalances[_account] = newBoostedBalance;

            if (newBoostedBalance > boostedBalance) {
                emit Transfer(address(0), _account, newBoostedBalance - boostedBalance);
            } else {
                emit Transfer(_account, address(0), boostedBalance - newBoostedBalance);
            }
        }
    }

    /**
     * @dev Computes the boost for
     * boost = min(m, max(1, 0.95 + c * min(voting_weight, f) / deposit^(3/4)))
     * @param _scaledDeposit deposit amount in terms of USD
     */
    function _computeBoost(uint256 _scaledDeposit, uint256 _votingWeight)
        private
        view
        returns (uint256 boost)
    {
        if (_votingWeight == 0) return MIN_BOOST;

        // Compute balance to the power 3/4
        uint256 sqrt1 = Root.sqrt(_scaledDeposit * 1e6);
        uint256 sqrt2 = Root.sqrt(sqrt1);
        uint256 denominator = sqrt1 * sqrt2;
        boost =
            (((StableMath.min(_votingWeight, MAX_VMTA) * boostCoeff) / 10) * 1e18) /
            denominator;
        boost = StableMath.min(MAX_BOOST, StableMath.max(MIN_BOOST, FLOOR + boost));
    }
}
