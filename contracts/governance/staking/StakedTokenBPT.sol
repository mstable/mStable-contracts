// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
pragma abicoder v2;

import { StakedToken } from "./StakedToken.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IBVault, ExitPoolRequest } from "./interfaces/IBVault.sol";

/**
 * @title StakedTokenBPT
 * @dev Derives from StakedToken, and simply adds the ability to withdraw any unclaimed $BAL tokens
 * that are at this address
 **/
contract StakedTokenBPT is StakedToken {
    using SafeERC20 for IERC20;

    /// @notice Balancer token
    IERC20 public immutable BAL;

    /// @notice Balancer vault
    IBVault public immutable balancerVault;

    /// @notice Balancer poolId
    bytes32 public immutable poolId;

    /// @notice contract that can redistribute the $BAL
    address public balRecipient;

    /// @notice Keeper
    address public keeper;

    /// @notice Pending fees in BPT terms
    uint256 public pendingBPTFees;

    /// @notice Most recent PriceCoefficient
    uint256 public priceCoefficient;

    /// @notice Time of last priceCoefficient upgrade
    uint256 public lastPriceUpdateTime;

    event KeeperUpdated(address newKeeper);
    event BalClaimed();
    event BalRecipientChanged(address newRecipient);
    event PriceCoefficientUpdated(uint256 newPriceCoeff);
    event FeesConverted(uint256 bpt, uint256 mta);

    /***************************************
                    INIT
    ****************************************/

    /**
     * @param _nexus System nexus
     * @param _rewardsToken Token that is being distributed as a reward. eg MTA
     * @param _stakedToken Core token that is staked and tracked (e.g. MTA)
     * @param _cooldownSeconds Seconds a user must wait after she initiates her cooldown before withdrawal is possible
     * @param _unstakeWindow Window in which it is possible to withdraw, following the cooldown period
     * @param _bal Balancer addresses, [0] = $BAL addr, [1] = BAL vault
     * @param _poolId Balancer Pool identifier
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _questManager,
        address _stakedToken,
        uint256 _cooldownSeconds,
        uint256 _unstakeWindow,
        address[2] memory _bal,
        bytes32 _poolId
    )
        StakedToken(
            _nexus,
            _rewardsToken,
            _questManager,
            _stakedToken,
            _cooldownSeconds,
            _unstakeWindow,
            true
        )
    {
        BAL = IERC20(_bal[0]);
        balancerVault = IBVault(_bal[1]);
        poolId = _poolId;
    }

    /**
     * @param _nameArg Token name
     * @param _symbolArg Token symbol
     * @param _rewardsDistributorArg mStable Rewards Distributor
     * @param _balRecipient contract that can redistribute the $BAL
     * @param _priceCoefficient Initial pricing coefficient
     */
    function initialize(
        bytes32 _nameArg,
        bytes32 _symbolArg,
        address _rewardsDistributorArg,
        address _balRecipient,
        uint256 _priceCoefficient
    ) external initializer {
        __StakedToken_init(_nameArg, _symbolArg, _rewardsDistributorArg);
        balRecipient = _balRecipient;
        priceCoefficient = _priceCoefficient;
    }

    modifier governorOrKeeper() {
        require(_msgSender() == _governor() || _msgSender() == keeper, "Gov or keeper");
        _;
    }

    /***************************************
                BAL incentives
    ****************************************/

    /**
     * @dev Claims any $BAL tokens present on this address as part of any potential liquidity mining program
     */
    function claimBal() external {
        uint256 balance = BAL.balanceOf(address(this));
        BAL.safeTransfer(balRecipient, balance);

        emit BalClaimed();
    }

    /**
     * @dev Sets the recipient for any potential $BAL earnings
     */
    function setBalRecipient(address _newRecipient) external onlyGovernor {
        balRecipient = _newRecipient;

        emit BalRecipientChanged(_newRecipient);
    }

    /***************************************
                    FEES
    ****************************************/

    /**
     * @dev Converts fees accrued in BPT into MTA, before depositing to the rewards contract
     */
    function convertFees() external nonReentrant {
        uint256 pendingBPT = pendingBPTFees;
        require(pendingBPT > 1, "Must have something to convert");
        pendingBPTFees = 1;

        // 1. Sell the BPT
        uint256 stakingBalBefore = STAKED_TOKEN.balanceOf(address(this));
        uint256 mtaBalBefore = REWARDS_TOKEN.balanceOf(address(this));
        (address[] memory tokens, , ) = balancerVault.getPoolTokens(poolId);
        require(tokens[0] == address(REWARDS_TOKEN), "MTA in wrong place");

        // 1.1. Calculate minimum output amount
        uint256[] memory minOut = new uint256[](2);
        {
            // 10% discount from the latest pcoeff
            // e.g. 1e18 * 42000 / 11000 = 3.81e18
            minOut[0] = (pendingBPT * priceCoefficient) / 11000;
        }

        // 1.2. Exits to here, from here. Assumes token is in position 0
        balancerVault.exitPool(
            poolId,
            address(this),
            payable(address(this)),
            ExitPoolRequest(tokens, minOut, bytes(abi.encode(0, pendingBPT - 1, 0)), false)
        );

        // 2. Verify and update state
        uint256 stakingBalAfter = STAKED_TOKEN.balanceOf(address(this));
        require(
            stakingBalAfter == (stakingBalBefore - pendingBPT + 1),
            "Must sell correct amount of BPT"
        );

        // 3. Inform HeadlessRewards about the new rewards
        uint256 received = REWARDS_TOKEN.balanceOf(address(this)) - mtaBalBefore;
        require(received >= minOut[0], "Must receive tokens");
        super._notifyAdditionalReward(received);

        emit FeesConverted(pendingBPT, received);
    }

    /**
     * @dev Called by the child contract to notify of any additional rewards that have accrued.
     *      Trusts that this is called honestly.
     * @param _additionalReward Units of additional RewardToken to add at the next notification
     */
    function _notifyAdditionalReward(uint256 _additionalReward) internal override {
        require(_additionalReward < 1e24, "more than a million units");

        pendingBPTFees += _additionalReward;
    }

    /***************************************
                    PRICE
    ****************************************/

    /**
     * @dev Sets the keeper that is responsible for fetching new price coefficients
     */
    function setKeeper(address _newKeeper) external onlyGovernor {
        keeper = _newKeeper;

        emit KeeperUpdated(_newKeeper);
    }

    /**
     * @dev Allows the governor or keeper to update the price coeff
     */
    function fetchPriceCoefficient() external governorOrKeeper {
        require(block.timestamp > lastPriceUpdateTime + 14 days, "Max 1 update per 14 days");

        uint256 newPriceCoeff = getProspectivePriceCoefficient();
        uint256 oldPriceCoeff = priceCoefficient;
        uint256 diff = newPriceCoeff > oldPriceCoeff
            ? newPriceCoeff - oldPriceCoeff
            : oldPriceCoeff - newPriceCoeff;

        // e.g. 500 * 10000 / 35000 = 5000000 / 35000 = 142
        require((diff * 10000) / oldPriceCoeff > 500, "Must be > 5% diff");
        require(newPriceCoeff > 15000 && newPriceCoeff < 75000, "Out of bounds");

        priceCoefficient = newPriceCoeff;
        lastPriceUpdateTime = block.timestamp;

        emit PriceCoefficientUpdated(newPriceCoeff);
    }

    /**
     * @dev Fetches most recent priceCoeff from the balancer pool.
     * PriceCoeff = units of MTA per BPT, scaled to 1:1 = 10000
     * Assuming an 80/20 BPT, it is possible to calculate
     * PriceCoeff (p) = balanceOfMTA in pool (b) / bpt supply (s) / 0.8
     * p = b * 1.25 / s
     */
    function getProspectivePriceCoefficient() public view returns (uint256 newPriceCoeff) {
        (address[] memory tokens, uint256[] memory balances, ) = balancerVault.getPoolTokens(
            poolId
        );
        require(tokens[0] == address(REWARDS_TOKEN), "MTA in wrong place");

        // Calculate units of MTA per BPT
        // e.g. 800e18 * 125e16 / 1000e18 = 1e18
        // e.g. 1280e18 * 125e16 / 1000e18 = 16e17
        uint256 unitsPerToken = (balances[0] * 125e16) / STAKED_TOKEN.totalSupply();
        // e.g. 1e18 / 1e14 = 10000
        // e.g. 16e17 / 1e14 = 16000
        newPriceCoeff = unitsPerToken / 1e14;
    }

    /**
     * @dev Get the current priceCoeff
     */
    function _getPriceCoeff() internal view override returns (uint256) {
        return priceCoefficient;
    }
}
