// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IEmissionsController } from "../interfaces/IEmissionsController.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { IRevenueRecipient } from "../interfaces/IRevenueRecipient.sol";
import { DialData } from "../emissions/EmissionsController.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IUniswapV3SwapRouter } from "../peripheral/Uniswap/IUniswapV3SwapRouter.sol";

/**
 * @title   RevenueSplitBuyBack
 * @author  mStable
 * @notice  Uses governance fees to buy MTA rewards for stakers. Updated Version sends some governance fees to treasury.
 * @dev     VERSION: 2.0
 *          DATE:    2022-04-17
 */
contract RevenueSplitBuyBack is IRevenueRecipient, Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    event RevenueReceived(address indexed mAsset, uint256 amountIn);
    event BuyBackRewards(
        address indexed mAsset,
        uint256 mAssetsToTreasury,
        uint256 mAssetsSold,
        uint256 rewardsAmount
    );
    event DonatedRewards(uint256 totalRewards);
    event MappedBasset(address indexed mAsset, address indexed bAsset);
    event AddedStakingContract(uint16 stakingDialId);
    event TreasuryFeeChanged(uint256 treasuryFee);
    event TreasuryChanged(address treasury);

    /// @notice scale of the `minMasset2BassetPrice` and `minBasset2RewardsPrice` configuration properties.
    uint256 public constant CONFIG_SCALE = 1e18;

    /// @notice address of the rewards token that is being purchased. eg MTA
    IERC20 public immutable REWARDS_TOKEN;
    /// @notice address of the Emissions Controller that does the weekly MTA reward emissions based off on-chain voting power.
    IEmissionsController public immutable EMISSIONS_CONTROLLER;
    /// @notice Uniswap V3 Router address
    IUniswapV3SwapRouter public immutable UNISWAP_ROUTER;

    /// @notice Mapping of mAssets to bAssets
    mapping(address => address) public bassets;
    /// @notice Emissions Controller dial ids for all staking contracts that will receive reward tokens.
    uint256[] public stakingDialIds;

    /// @notice percentage of governance fees that is sent to the Treasury where 100% = 1e18
    uint256 public treasuryFee;

    /// @notice address the Treasury fees are transferred to.
    address public treasury;

    /**
     * @param _nexus mStable system Nexus address
     * @param _rewardsToken Rewards token address that are purchased. eg MTA
     * @param _uniswapRouter Uniswap V3 Router address
     * @param _emissionsController Emissions Controller address that rewards tokens are donated to.
     */
    constructor(
        address _nexus,
        address _rewardsToken,
        address _uniswapRouter,
        address _emissionsController
    ) ImmutableModule(_nexus) {
        require(_rewardsToken != address(0), "Rewards token is zero");
        REWARDS_TOKEN = IERC20(_rewardsToken);

        require(_uniswapRouter != address(0), "Uniswap Router is zero");
        UNISWAP_ROUTER = IUniswapV3SwapRouter(_uniswapRouter);

        require(_emissionsController != address(0), "Emissions controller is zero");
        EMISSIONS_CONTROLLER = IEmissionsController(_emissionsController);
    }

    /**
     * @param _stakingDialIds Emissions Controller dial ids for all staking contracts that will receive reward tokens.
     * @param _treasury Address the treasury fees are transferred to.
     * @param _treasuryFee percentage of governence fees to be sent to treasury where 100% = 1e18.
     */
    function initialize(
        uint16[] memory _stakingDialIds,
        address _treasury,
        uint256 _treasuryFee
    ) external initializer {
        for (uint256 i = 0; i < _stakingDialIds.length; i++) {
            _addStakingContract(_stakingDialIds[i]);
        }

        // RevenueBuyBack approves the Emissions Controller to transfer rewards. eg MTA
        REWARDS_TOKEN.safeApprove(address(EMISSIONS_CONTROLLER), type(uint256).max);

        require(_treasury != address(0), "Treasury is zero");
        treasury = _treasury;

        _setTreasuryFee(_treasuryFee);
    }

    /***************************************
                    EXTERNAL
    ****************************************/

    /**
     * @dev Simply transfers the mAsset from the sender to here
     * @param _mAsset Address of mAsset
     * @param _amount Units of mAsset collected
     */
    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external override {
        require(bassets[_mAsset] != address(0), "Invalid mAsset");

        // Transfer from sender to here
        IERC20(_mAsset).safeTransferFrom(msg.sender, address(this), _amount);

        emit RevenueReceived(_mAsset, _amount);
    }

    /**
     * @notice Buys reward tokens, eg MTA, using mAssets like mUSD or mBTC from protocol governance fees.
     * @param mAssets Addresses of mAssets that are to be sold for rewards. eg mUSD and mBTC.
     * @param minBassetsAmounts Minimum amount of bAsset tokens to receive for each redeem of mAssets.
     * The amount uses the decimal places of the bAsset.
     * Example 1: Redeeming 10,000 mUSD with a min 2% slippage to USDC which has 6 decimal places
     * minBassetsAmounts = 10,000 mAssets * slippage 0.98 * USDC decimals 1e6 =
     * 1e4 * 0.98 * 1e6 = 1e10 * 0.98 = 98e8
     *
     * Example 2: Redeeming 1 mBTC with a min 5% slippage to WBTC which has 8 decimal places
     * minBassetsAmounts = 1 mAsset * slippage 0.95 * WBTC decimals 1e8 =
     * 0.95 * 1e8 = 95e6
     *
     * @param minRewardsAmounts Minimum amount of reward tokens received from the sale of bAssets.
     * The amount uses the decimal places of the rewards token.
     * Example 1: Swapping 10,000 USDC with a min 1% slippage to MTA which has 18 decimal places
     * minRewardsAmounts = 10,000 USDC * slippage 0.99 * MTA decimals 1e18 * MTA/USD rate 1.2
     * = 1e4 * 0.99 * 1e18 * 1.2 = 1e22 * 0.99 = 99e20
     *
     * Example 1: Swapping 1 WBTC with a min 3% slippage to MTA which has 18 decimal places
     * minRewardsAmounts = 1 WBTC * slippage 0.97 * MTA decimals 1e18 * MTA/BTC rate 0.00001
     * = 1 * 0.97 * 1e18 * 0.00001 = 0.97 * 1e13 = 97e11
     *
     * @param uniswapPaths The Uniswap V3 bytes encoded paths.
     */
    function buyBackRewards(
        address[] calldata mAssets,
        uint256[] memory minBassetsAmounts,
        uint256[] memory minRewardsAmounts,
        bytes[] calldata uniswapPaths
    )
        external
        onlyKeeperOrGovernor
        returns (
            uint256 mAssetToTreasury,
            uint256 mAssetsSellAmount,
            uint256 rewardsAmount
        )
    {
        uint256 len = mAssets.length;
        require(len > 0, "Invalid mAssets");
        require(minBassetsAmounts.length == len, "Invalid minBassetsAmounts");
        require(minRewardsAmounts.length == len, "Invalid minRewardsAmounts");
        require(uniswapPaths.length == len, "Invalid uniswapPaths");

        // for each mAsset
        for (uint256 i = 0; i < len; i++) {
            // Get bAsset for mAsset
            address bAsset = bassets[mAssets[i]];
            require(bAsset != address(0), "Invalid mAsset");
            // Validate Uniswap path
            require(
                _validUniswapPath(bAsset, address(REWARDS_TOKEN), uniswapPaths[i]),
                "Invalid uniswap path"
            );

            // Get mAsset revenue
            uint256 mAssetBal = IERC20(mAssets[i]).balanceOf(address(this));

            // If a portion of the revenue is being sent to treasury
            if (treasuryFee > 0) {
                // STEP 1: Send mAsset to treasury
                mAssetToTreasury = (mAssetBal * treasuryFee) / CONFIG_SCALE;
                IERC20(mAssets[i]).safeTransfer(treasury, mAssetToTreasury);
            }

            // If some portion of the revenue is used to buy back rewards tokens
            if (treasuryFee < CONFIG_SCALE) {
                mAssetsSellAmount = mAssetBal - mAssetToTreasury;

                // STEP 2 - Redeem mAssets for bAssets
                uint256 bAssetAmount = IMasset(mAssets[i]).redeem(
                    bAsset,
                    mAssetsSellAmount,
                    minBassetsAmounts[i],
                    address(this)
                );

                // STEP 3 - Swap bAssets for rewards using Uniswap V3
                IERC20(bAsset).safeApprove(address(UNISWAP_ROUTER), bAssetAmount);
                IUniswapV3SwapRouter.ExactInputParams memory param = IUniswapV3SwapRouter
                .ExactInputParams(
                    uniswapPaths[i],
                    address(this),
                    block.timestamp,
                    bAssetAmount,
                    minRewardsAmounts[i]
                );
                rewardsAmount = UNISWAP_ROUTER.exactInput(param);
            }

            emit BuyBackRewards(mAssets[i], mAssetToTreasury, mAssetsSellAmount, rewardsAmount);
        }
    }

    /**
     * @notice donates purchased rewards, eg MTA, to staking contracts via the Emissions Controller.
     */
    function donateRewards() external onlyKeeperOrGovernor {
        // STEP 1 - Get the voting power of the staking contracts
        uint256 numberStakingContracts = stakingDialIds.length;
        uint256[] memory votingPower = new uint256[](numberStakingContracts);
        uint256 totalVotingPower;
        // Get the voting power of each staking contract
        for (uint256 i = 0; i < numberStakingContracts; i++) {
            address stakingContractAddress = EMISSIONS_CONTROLLER.getDialRecipient(
                stakingDialIds[i]
            );
            require(stakingContractAddress != address(0), "invalid dial id");

            votingPower[i] = IERC20(stakingContractAddress).totalSupply();
            totalVotingPower += votingPower[i];
        }
        require(totalVotingPower > 0, "No voting power");

        // STEP 2 - Get rewards that need to be distributed
        uint256 rewardsBal = REWARDS_TOKEN.balanceOf(address(this));
        require(rewardsBal > 0, "No rewards to donate");

        // STEP 3 - Calculate rewards for each staking contract
        uint256[] memory rewardDonationAmounts = new uint256[](numberStakingContracts);
        for (uint256 i = 0; i < numberStakingContracts; i++) {
            rewardDonationAmounts[i] = (rewardsBal * votingPower[i]) / totalVotingPower;
        }

        // STEP 4 - donate rewards to staking contract dials in the Emissions Controller
        EMISSIONS_CONTROLLER.donate(stakingDialIds, rewardDonationAmounts);

        // To get a details split of rewards to staking contracts,
        // see the `DonatedRewards` event on the `EmissionsController`
        emit DonatedRewards(rewardsBal);
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @notice Maps a mAsset to bAsset.
     * @param _mAsset Address of the meta asset that is received as governance fees.
     * @param _bAsset Address of the base asset that is redeemed from the mAsset.
     */
    function mapBasset(address _mAsset, address _bAsset) external onlyGovernor {
        require(_mAsset != address(0), "mAsset token is zero");
        require(_bAsset != address(0), "bAsset token is zero");

        bassets[_mAsset] = _bAsset;

        emit MappedBasset(_mAsset, _bAsset);
    }

    /**
     * @notice Sets the percentage of governence fees to be sent to treasury.
     * @param _treasuryFee percentage of governence fees to be sent to treasury where 100% = 1e18.
     */
    function setTreasuryFee(uint256 _treasuryFee) external onlyGovernor {
        _setTreasuryFee(_treasuryFee);
    }

    function _setTreasuryFee(uint256 _treasuryFee) internal {
        require(_treasuryFee <= CONFIG_SCALE, "Invalid treasury fee");

        treasuryFee = _treasuryFee;

        emit TreasuryFeeChanged(treasuryFee);
    }

    /**
     * @notice Sets the address the treasury fees are transerred to.
     * @param _treasury Address the treasury fees are transferred to.
     */
    function setTreasury(address _treasury) external onlyGovernor {
        require(_treasury != address(0), "Treasury is zero");
        treasury = _treasury;

        emit TreasuryChanged(_treasury);
    }

    /**
     * @notice Adds a new staking contract that will receive MTA rewards
     * @param _stakingDialId dial identifier from the Emissions Controller of the staking contract.
     */
    function addStakingContract(uint16 _stakingDialId) external onlyGovernor {
        _addStakingContract(_stakingDialId);
    }

    function _addStakingContract(uint16 _stakingDialId) internal {
        for (uint256 i = 0; i < stakingDialIds.length; i++) {
            require(stakingDialIds[i] != _stakingDialId, "Staking dial id already exists");
        }
        // Make sure the dial id of the staking contract is valid
        require(
            EMISSIONS_CONTROLLER.getDialRecipient(_stakingDialId) != address(0),
            "Missing staking dial"
        );

        stakingDialIds.push(_stakingDialId);

        emit AddedStakingContract(_stakingDialId);
    }

    /**
     * @notice Validates a given uniswap path - valid if sellToken at position 0 and bAsset at end
     * @param _sellToken Token harvested from the integration contract
     * @param _bAsset New asset to buy on Uniswap
     * @param _uniswapPath The Uniswap V3 bytes encoded path.
     */
    function _validUniswapPath(
        address _sellToken,
        address _bAsset,
        bytes calldata _uniswapPath
    ) internal pure returns (bool) {
        uint256 len = _uniswapPath.length;
        require(_uniswapPath.length >= 43, "Uniswap path too short");
        // check sellToken is first 20 bytes and bAsset is the last 20 bytes of the uniswap path
        return
            keccak256(abi.encodePacked(_sellToken)) ==
            keccak256(abi.encodePacked(_uniswapPath[0:20])) &&
            keccak256(abi.encodePacked(_bAsset)) ==
            keccak256(abi.encodePacked(_uniswapPath[len - 20:len]));
    }

    /**
     * @dev Abstract override
     */
    function depositToPool(
        address[] calldata, /* _mAssets */
        uint256[] calldata /* _percentages */
    ) external override {}
}
