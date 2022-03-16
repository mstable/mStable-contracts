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
 * @title   RevenueBuyBack
 * @author  mStable
 * @notice  Uses protocol revenue to buy MTA rewards for stakers. Updated Version to set and send protocol fee to treasury.
 * @dev     VERSION: 2.0
 *          DATE:    2021-11-09
 */
contract RevenueBuyBack is IRevenueRecipient, Initializable, ImmutableModule {
    using SafeERC20 for IERC20;

    event RevenueReceived(address indexed mAsset, uint256 amountIn);
    event BuyBackRewards(
        address indexed mAsset,
        uint256 mAssetAmount,
        uint256 mAssetToTreasury,
        uint256 bAssetAmount,
        uint256 rewardsAmount
    );
    event DonatedRewards(uint256 totalRewards);
    event MappedBasset(address indexed mAsset, address indexed bAsset);
    event AddedStakingContract(uint16 stakingDialId);
    event ProtocolFeeChanged(uint256 protocolFee);
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

    /// @notice ProtocolFee, how much does go back to the Treasury? 100% = 1e18
    uint256 public protocolFee;

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
        address _emissionsController,
        uint256 _protocolFee
    ) ImmutableModule(_nexus) {
        require(_rewardsToken != address(0), "Rewards token is zero");
        REWARDS_TOKEN = IERC20(_rewardsToken);

        require(_uniswapRouter != address(0), "Uniswap Router is zero");
        UNISWAP_ROUTER = IUniswapV3SwapRouter(_uniswapRouter);

        require(_emissionsController != address(0), "Emissions controller is zero");
        EMISSIONS_CONTROLLER = IEmissionsController(_emissionsController);

        require(_protocolFee <= CONFIG_SCALE, "Invalid protocol fee");
        protocolFee = _protocolFee;
    }

    /**
     * @param _stakingDialIds Emissions Controller dial ids for all staking contracts that will receive reward tokens.
     * @param _treasury Address the treasury fees are transferred to.
     */
    function initialize(uint16[] memory _stakingDialIds, address _treasury) external initializer {
        for (uint256 i = 0; i < _stakingDialIds.length; i++) {
            _addStakingContract(_stakingDialIds[i]);
        }

        // RevenueBuyBack approves the Emissions Controller to transfer rewards. eg MTA
        REWARDS_TOKEN.safeApprove(address(EMISSIONS_CONTROLLER), type(uint256).max);

        require(_treasury != address(0), "Treasury is zero");
        treasury = _treasury;
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
     * @notice Buys reward tokens, eg MTA, using mAssets like mUSD or mBTC from protocol revenue.
     * @param mAssets Addresses of mAssets that are to be sold for rewards. eg mUSD and mBTC.
     * @param minMasset2BassetPrices Minimum prices of bAssets compared to mAssets scaled to 1e18 (CONFIG_SCALE).
     * eg USDC/mUSD and wBTC/mBTC exchange rates.
     * USDC has 6 decimal places so `minMasset2BassetPrice` with no slippage is 1e6.
     * If a 2% slippage is allowed, the `minMasset2BassetPrice` is 98e4.
     * WBTC has 8 decimal places so `minMasset2BassetPrice` with no slippage is 1e8.
     * If a 5% slippage is allowed, the `minMasset2BassetPrice` is 95e6.
     * @param minBasset2RewardsPrices Minimum prices of rewards token compared to bAssets scaled to 1e18 (CONFIG_SCALE).
     * eg USDC/MTA and wBTC/MTA exchange rates scaled to 1e18.
     * USDC only has 6 decimal places
     * 2 MTA/USDC = 0.5 USDC/MTA * (1e18 / 1e6) * 1e18 = 0.5e30 = 5e29
     * wBTC only has 8 decimal places
     * 0.000033 MTA/wBTC = 30,000 WBTC/MTA * (1e18 / 1e8) * 1e18 = 3e4 * 1e28 = 3e32
     * @param uniswapPaths The Uniswap V3 bytes encoded paths.
     */
    function buyBackRewards(
        address[] calldata mAssets,
        uint256[] memory minMasset2BassetPrices,
        uint256[] memory minBasset2RewardsPrices,
        bytes[] calldata uniswapPaths
    ) external onlyKeeperOrGovernor {
        uint256 len = mAssets.length;
        require(len > 0, "Invalid mAssets");
        require(minMasset2BassetPrices.length == len, "Invalid minMasset2BassetPrices");
        require(minBasset2RewardsPrices.length == len, "Invalid minBasset2RewardsPrices");
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
            uint256 mAssetToTreasury = 0;

            if (protocolFee > 0) {
                // STEP 1: Send mAsset to treasury
                mAssetToTreasury =
                    (IERC20(mAssets[i]).balanceOf(address(this)) * protocolFee) /
                    CONFIG_SCALE;
                IERC20(mAssets[i]).safeTransfer(treasury, mAssetToTreasury);
            }

            // STEP 2 - Redeem mAssets for bAssets
            // STEP 3 - Swap bAssets for rewards using Uniswap V3
            (uint256 bAssetAmount, uint256 rewardsAmount) = _redeemAndSwap(
                mAssets[i],
                bAsset,
                minMasset2BassetPrices[i],
                minBasset2RewardsPrices[i],
                uniswapPaths[i]
            );

            emit BuyBackRewards(
                mAssets[i],
                mAssetBal,
                mAssetToTreasury,
                bAssetAmount,
                rewardsAmount
            );
        }
    }

    function _redeemAndSwap(
        address mAsset,
        address bAsset,
        uint256 minMasset2BassetPrice,
        uint256 minBasset2RewardsPrice,
        bytes memory uniswapPath
    ) internal returns (uint256 bAssetAmount, uint256 rewardsAmount) {
        // STEP 2 - Redeem mAssets for bAssets
        uint256 mAssetBalAfterFee = IERC20(mAsset).balanceOf(address(this));
        uint256 minBassetOutput = (mAssetBalAfterFee * minMasset2BassetPrice) / CONFIG_SCALE;
        bAssetAmount = IMasset(mAsset).redeem(
            bAsset,
            mAssetBalAfterFee,
            minBassetOutput,
            address(this)
        );

        // STEP 3 - Swap bAssets for rewards using Uniswap V3
        IERC20(bAsset).safeApprove(address(UNISWAP_ROUTER), bAssetAmount);
        uint256 minRewardsAmount = (bAssetAmount * minBasset2RewardsPrice) / CONFIG_SCALE;
        IUniswapV3SwapRouter.ExactInputParams memory param = IUniswapV3SwapRouter.ExactInputParams(
            uniswapPath,
            address(this),
            block.timestamp,
            bAssetAmount,
            minRewardsAmount
        );
        rewardsAmount = UNISWAP_ROUTER.exactInput(param);
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
     * @param _mAsset Address of the meta asset that is received as protocol revenue.
     * @param _bAsset Address of the base asset that is redeemed from the mAsset.
     */
    function mapBasset(address _mAsset, address _bAsset) external onlyGovernor {
        require(_mAsset != address(0), "mAsset token is zero");
        require(_bAsset != address(0), "bAsset token is zero");

        bassets[_mAsset] = _bAsset;

        emit MappedBasset(_mAsset, _bAsset);
    }

    /**
     * @notice Sets the protocol fee. Protocol fees are paid to the Treasury
     * @param _protocolFee The protocol fee in 100% = 1e18.
     */
    function setProtocolFee(uint128 _protocolFee) external onlyGovernor {
        require(_protocolFee <= CONFIG_SCALE, "Invalid protocol fee");
        protocolFee = _protocolFee;
        emit ProtocolFeeChanged(protocolFee);
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
