// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IEmissionsController } from "../interfaces/IEmissionsController.sol";
import { IMasset } from "../interfaces/IMasset.sol";
import { IRevenueRecipient } from "../interfaces/IRevenueRecipient.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IUniswapV3SwapRouter } from "../peripheral/Uniswap/IUniswapV3SwapRouter.sol";

struct RevenueBuyBackConfig {
    // Percentage of mAssets that can be redeemed for bAssets in basis points (BASSET_PECENTAGE_SCALE).
    // So if a 2% slippage is allowed, the minRedeemSlippage will be 9800.
    // A 0.01% slippage is 9999
    uint16 minBassetPercentage;
    // Minimum price of rewards token compared to bAssets. eg MTA/USDC or MTA/wBTC.
    // The price is scaled by 100 (REWARDS_PRICE_SCALE).
    // Examples
    // 0.80 MTA/USDC price = 80
    // 50000 MTA/wBTC price = 5,000,000
    uint32 minBasset2RewardsPrice;
    // base asset of the mAsset that is being redeemed and then sold for reward tokens.
    address bAsset;
    // Uniswap V3 path
    bytes uniswapPath;
}

/**
 * @title   RevenueBuyBack
 * @author  mStable
 * @notice  Uses protocol revenue to buy MTA rewards for stakers.
 * @dev     VERSION: 1.0
 *          DATE:    2021-11-09
 */
contract RevenueBuyBack is IRevenueRecipient, Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    event RevenueReceived(address indexed mAsset, uint256 amountIn);
    event AddedMassetConfig(
        address mAsset,
        address bAsset,
        uint16 minBassetPercentage,
        uint32 minBasset2RewardsPrice,
        bytes uniswapPath
    );
    event AddedStakingContract(uint16 stakingDialId);

    uint256 public constant BASSET_PECENTAGE_SCALE = 10000;
    uint256 public constant REWARDS_PRICE_SCALE = 100;

    /// @notice address of the rewards token that is being purchased. eg MTA
    IERC20 public immutable REWARDS_TOKEN;
    IEmissionsController public immutable EMISSIONS_CONTROLLER;

    /// @notice Uniswap V3 Router address
    IUniswapV3SwapRouter public immutable uniswapRouter;

    /// @notice Account that can execute `buyBackRewards`. eg Operations account.
    address public keeper;
    /// @notice Mapping of mAssets to RevenueBuyBack config
    mapping(address => RevenueBuyBackConfig) public massetConfig;
    /// @notice Emissions Controller dial ids for all staking contracts that will receive reward tokens.
    uint256[] public stakingDialIds;

    modifier keeperOrGovernor() {
        require(msg.sender == keeper || msg.sender == _governor(), "Only keeper or governor");
        _;
    }

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
        uniswapRouter = IUniswapV3SwapRouter(_uniswapRouter);

        require(_uniswapRouter != address(0), "Emissions controller is zero");
        EMISSIONS_CONTROLLER = IEmissionsController(_emissionsController);
    }

    /**
     * @param _keeper Account that can execute `buyBackRewards`. eg Operations account.
     * @param _stakingDialIds Emissions Controller dial ids for all staking contracts that will receive reward tokens.
     */
    function initialize(address _keeper, uint16[] memory _stakingDialIds) external initializer {
        require(_keeper != address(0), "Keeper is zero");
        keeper = _keeper;

        for (uint256 i = 0; i < _stakingDialIds.length; i++) {
            require(_stakingDialIds[i] != 0, "Staking dial id is zero");
            stakingDialIds.push(_stakingDialIds[i]);
        }
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
        // Transfer from sender to here
        IERC20(_mAsset).safeTransferFrom(msg.sender, address(this), _amount);

        emit RevenueReceived(_mAsset, _amount);
    }

    /**
     * @notice Buys reward tokens, eg MTA, using mAssets like mUSD or mBTC from protocol revenue.
     * @param _mAssets Addresses of mAssets that are to be sold for rewards. eg mUSD and mBTC.
     */
    function buyBackRewards(address[] calldata _mAssets) external keeperOrGovernor {
        uint256 len = _mAssets.length;
        require(len > 0, "Invalid args");

        // for each mAsset
        for (uint256 i = 0; i < len; i++) {
            // Get config for mAsset
            RevenueBuyBackConfig memory config = massetConfig[_mAssets[i]];
            require(config.bAsset != address(0), "Invalid mAsset");

            // STEP 1 - Redeem mAssets for bAssets
            IMasset mAsset = IMasset(_mAssets[i]);
            uint256 mAssetBal = IERC20((_mAssets[i])).balanceOf(address(this));
            uint256 minBassetOutput = (mAssetBal * config.minBassetPercentage) /
                BASSET_PECENTAGE_SCALE;
            uint256 bAssetAmount = mAsset.redeem(
                config.bAsset,
                mAssetBal,
                minBassetOutput,
                address(this)
            );

            // STEP 2 - Swap bAssets for rewards using Uniswap V3
            uint256 minRewardsAmount = (bAssetAmount * config.minBasset2RewardsPrice) /
                REWARDS_PRICE_SCALE;
            IUniswapV3SwapRouter.ExactInputParams memory param = IUniswapV3SwapRouter
            .ExactInputParams(
                config.uniswapPath,
                address(this),
                block.timestamp,
                bAssetAmount,
                minRewardsAmount
            );
            uniswapRouter.exactInput(param);
        }
    }

    /**
     * @notice donates purchased rewards, eg MTA, to staking contracts via the Emissions Controller.
     */
    function donateRewards() external keeperOrGovernor {
        // STEP 1 - Get the voting power of the staking contracts
        uint256 numberStakingContracts = stakingDialIds.length;
        uint256[] memory votingPower = new uint256[](numberStakingContracts);
        uint256 totalVotingPower;
        // Get the voting power of each staking contract
        for (uint256 i = 0; i < numberStakingContracts; i++) {
            address staingContractAddress = EMISSIONS_CONTROLLER.stakingContracts(stakingDialIds[i]);
            require(staingContractAddress != address(0), "invalid dial id");

            votingPower[i] = IERC20(staingContractAddress).totalSupply();
            totalVotingPower += votingPower[i];
        }
        require(totalVotingPower > 0, "No voting power");

        // STEP 2 - Get rewards that need to be distributed
        uint256 rewardsBal = REWARDS_TOKEN.balanceOf(address(this));

        // STEP 3 - Calculate rewards for each staking contract
        uint256[] memory rewardDonationAmounts = new uint256[](numberStakingContracts);
        for (uint256 i = 0; i < numberStakingContracts; i++) {
            rewardDonationAmounts[i] = rewardsBal * votingPower[i] / totalVotingPower;
        }

        // STEP 4 - donate rewards to staking contract dials in the Emissions Controller
        EMISSIONS_CONTROLLER.donate(stakingDialIds, rewardDonationAmounts);
    }

    /***************************************
                    ADMIN
    ****************************************/

    /**
     * @notice Adds or updates rewards buyback config for a mAsset.
     * @param _mAsset Address of the meta asset that is received as protocol revenue.
     * @param _bAsset Address of the base asset that is redeemed from the mAsset.
     * @param _minBassetPercentage Percentage of mAssets that can be redeemed for bAssets in basis points.
     * So if a 2% slippage is allowed, the minRedeemSlippage will be 9800.
     * A 0.01% slippage is 9999
     * @param _minBasset2RewardsPrice Minimum price of rewards token compared to bAssets. eg MTA/USDC or MTA/wBTC.
     * All prices are scaled by 100. Examples:
     * 0.80 MTA/USDC price = 80
     * 50000 MTA/wBTC price = 5,000,000
     * @param _uniswapPath The Uniswap V3 bytes encoded path.
     */
    function setMassetConfig(
        address _mAsset,
        address _bAsset,
        uint16 _minBassetPercentage,
        uint32 _minBasset2RewardsPrice,
        bytes calldata _uniswapPath
    ) external onlyGovernor {
        require(_mAsset != address(0), "mAsset token is zero");
        require(_bAsset != address(0), "bAsset token is zero");
        // bAsset slippage must be plus or minus 10%
        require(
            _minBassetPercentage > 9000 && _minBassetPercentage <= 11000,
            "Invalid min bAsset %"
        );
        require(_minBasset2RewardsPrice > 0, "Invalid min reward price");
        require(
            _validUniswapPath(_bAsset, address(REWARDS_TOKEN), _uniswapPath),
            "Invalid uniswap path"
        );

        massetConfig[_mAsset] = RevenueBuyBackConfig({
            bAsset: _bAsset,
            minBassetPercentage: _minBassetPercentage,
            minBasset2RewardsPrice: _minBasset2RewardsPrice,
            uniswapPath: _uniswapPath
        });

        emit AddedMassetConfig(
            _mAsset,
            _bAsset,
            _minBassetPercentage,
            _minBasset2RewardsPrice,
            _uniswapPath
        );
    }

    /**
     * @notice Adds a new staking contract that will receive MTA rewards
     * @param _stakingDialId dial identifier from the Emissions Controller of the staking contract.
     */
    function addStakingContract(uint16 _stakingDialId) external onlyGovernor {
        require(_stakingDialId != 0, "Staking dial id is zero");
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
