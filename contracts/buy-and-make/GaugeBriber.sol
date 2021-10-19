// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IUniswapV3SwapRouter } from "../peripheral/Uniswap/IUniswapV3SwapRouter.sol";
import { IUniswapV3Quoter } from "../peripheral/Uniswap/IUniswapV3Quoter.sol";
import { IRevenueRecipient } from "../interfaces/IRevenueRecipient.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVotiumBribe {
    function depositBribe(
        address _token,
        uint256 _amount,
        bytes32 _proposal,
        uint256 _choiceIndex
    ) external;
}

interface ICurveMetaPool {
    function exchange_underlying(
        int128 i,
        int128 j,
        uint256 dx,
        uint256 min_dy
    ) external returns (uint256);
}

// CONFIG
//  - votium: 0x19bbc3463dd8d07f55438014b021fb457ebd4595
//  - token: 0xa3bed4e1c75d00fa6f4e5e6922db7261b5e9acd2
//  - choice: 14

// TODO
//  - depositing bribe
//  - minOuts efficient
//  - rescue

/**
 * @title   GaugeBriber
 * @author  mStable
 * @notice  Collect system revenue in mUSD, converts to MTA, funds bribe on Votium
 * @dev     VERSION: 1.0
 *          DATE:    2021-10-19
 */
contract GaugeBriber is IRevenueRecipient, ImmutableModule {
    using SafeERC20 for IERC20;

    event RevenueReceived(address indexed mAsset, uint256 amountIn);

    IERC20 public immutable musd;
    IERC20 public immutable mta;

    ICurveMetaPool public curve;
    IUniswapV3SwapRouter public immutable uniswapRouter;
    IUniswapV3Quoter public immutable uniswapQuoter;

    IVotiumBribe public immutable votium;
    address public immutable keeper;

    IRevenueRecipient public childRecipient;
    uint256 public feeSplit;

    uint256[2] public available;

    // [0] = nexus
    // [1] = musd
    // [2] = mta
    // [3] = curve
    // [4] = uniswapRouter
    // [5] = uniswapQuoter
    // [6] = votium
    // [7] = keeper
    // [8] = childRecipient
    constructor(address[9] memory _config) ImmutableModule(_config[0]) {
        musd = IERC20(_config[1]);
        mta = IERC20(_config[2]);
        curve = ICurveMetaPool(_config[3]);
        uniswapRouter = IUniswapV3SwapRouter(_config[4]);
        uniswapQuoter = IUniswapV3Quoter(_config[5]);
        votium = IVotiumBribe(_config[6]);
        keeper = _config[7];

        IERC20(_config[1]).safeApprove(_config[3], 2**256 - 1);
        IERC20(_config[2]).safeApprove(_config[6], 2**256 - 1);
    }

    modifier keeperOrGovernor() {
        require(msg.sender == keeper || msg.sender == _governor(), "Only keeper or governor");
        _;
    }

    /**
     * @dev Simply transfers the mAsset from the sender to here
     * @param _mAsset Address of mAsset
     * @param _amount Units of mAsset collected
     */
    function notifyRedistributionAmount(address _mAsset, uint256 _amount) external override {
        // Transfer from sender to here
        IERC20(_mAsset).safeTransferFrom(msg.sender, address(this), _amount);

        available[0] += ((_amount * (1e18 - feeSplit)) / 1e18);
        available[1] += ((_amount * feeSplit) / 1e18);

        emit RevenueReceived(_mAsset, _amount);
    }

    function depositBribe(uint256 _minOutPerToken, bytes32 _proposal) external keeperOrGovernor {
        // 1. Sell mUSD for DAI on Curve (pass amt)
        uint256 purchased = curve.exchange_underlying(
            0,
            1,
            available[0],
            (available[0] * 99e16) / 1e18
        );
        available[0] = 0;
        // 2. Sell DAI for MTA on Uniswapv3
        //         IUniswapV3SwapRouter.ExactInputParams memory param = IUniswapV3SwapRouter
        // .ExactInputParams(
        //     liquidation.uniswapPath,
        //     address(this),
        //     block.timestamp + 1,
        //     aaveSellAmount,
        //     minBassetsOut
        // );
        // uniswapRouter.exactInput(param);
    }

    function _validUniswapPath(
        address _input,
        address _output,
        bytes calldata _uniswapPath
    ) internal pure returns (bool) {
        uint256 len = _uniswapPath.length;
        require(_uniswapPath.length >= 43, "Uniswap path too short");
        // check sellToken is first 20 bytes and bAsset is the last 20 bytes of the uniswap path
        return
            keccak256(abi.encodePacked(_input)) ==
            keccak256(abi.encodePacked(_uniswapPath[0:20])) &&
            keccak256(abi.encodePacked(_output)) ==
            keccak256(abi.encodePacked(_uniswapPath[len - 20:len]));
    }

    function depositToPool(
        address[] calldata, /* _mAssets */
        uint256[] calldata /* _percentages */
    ) external override {}

    function setChildDetails(address _newRecipient, uint256 _feeSplit) external onlyGovernor {
        require(_feeSplit <= 5e17, "Must be less than 50%");
        childRecipient = IRevenueRecipient(_newRecipient);
        feeSplit = _feeSplit;
    }

    function rescue(address _newRevenueRecipient) external onlyGovernor {
        // musd.safe
    }
}
