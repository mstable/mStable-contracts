// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

import "hardhat/console.sol";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IBasketManager } from "./IBasketManager.sol";
import { Basket, Basset } from "./MassetStructsV2.sol";
import { IMassetV2 } from "./IMassetV2.sol";

import { DyDxFlashLoan } from "./dydx/DyDxFlashLoan.sol";
import { MusdV3 } from "../../../masset/mUSD/MusdV3.sol";
import { ICurve } from "../../../interfaces/ICurve.sol";

interface IUSDT {
    function approve(address spender, uint256 amount) external;
    function balanceOf(address) external returns (uint256);
}

/**
Executes the following rebalance strategy as block 12000000

Flash loan 3.3m USDC from DyDx
Swap 2m USDC for TUSD using mUSD to balance USDC
Swap 1.3m USDC for USDT using Curve 3pool
Swap 1.3m USDT for TUSD using mUSD to balance USDT
Swap 3.3m TUSD for USDC on Curve Y pool
Fund 4,332 USDC loan shortfall
Repay 3.3m USDC flash loan to DyDx

Flash loan 15.5m DAI from DyDx
Swap 15.5m DAI for TUSD using mUSD to balance DAI and remove all TUSD
Swap 8m TUSD for DAI using Curve Y pool
Swap 7.5m TUSD for USDC using Curve Y pool
Swap 7.5m USDC for DAI using Curve 3pool
Fund 40k DAI loan shortfall
Repay 15.5m DAI flash loan to DyDx
 */
contract MusdV3Upgrade3PoolDyDx is DyDxFlashLoan {

    using SafeERC20 for IERC20;

    // TODO make immutable and set in constructor
    address constant funderAccount = 0xF977814e90dA44bFA03b6295A0616a897441aceC;

    address immutable private owner;
    MusdV3 constant mUsdV3 = MusdV3(0xe2f2a5C287993345a840Db3B0845fbC70f5935a5);
    IMassetV2 constant mUsdV2 = IMassetV2(0xe2f2a5C287993345a840Db3B0845fbC70f5935a5);
    IBasketManager constant basketManager = IBasketManager(0x66126B4aA2a1C07536Ef8E5e8bD4EfDA1FdEA96D);
    ICurve constant curve3pool = ICurve(0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7);
    ICurve constant curveYpool = ICurve(0x45F783CCE6B7FF23B2ab2D70e416cdb7D6055f51);

    event Balance(
        address flashToken,
        uint256 flashLoanAmount,
        uint256 swap1Output,
        uint256 flashLoanBalance,
        uint256 flashLoanShortfall);

    // Events from dependant contracts so Ethers can parse the topics
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor() {
        owner = msg.sender;
    }

    function upgrade() external {
        require(msg.sender == owner, "not owner");

        // Calculate swaps to balance mUSD
        (uint256 targetScaledBalance,
         int128[] memory differentToTargetScaled
        ) = getSwapAmounts();

        // Flash loan 15.5m DAI from DyDx
        // getFlashloan(DAI, targetScaledBalance);
        getFlashloan(DAI, 10e18);

        // Flash loan 3.3m USDC from DyDx
        // TODO USDC loan amount = USDC + USDT diffs from target
        uint256 usdcLoanAmount = 33e11;
        getFlashloan(USDC, usdcLoanAmount);
    }

    function getSwapAmounts() public returns (
        uint256 targetScaledBalance,
        int128[] memory differentToTargetScaled
    ) {
        // Get total amounts of bAssets
        Basket memory importedBasket = basketManager.getBasket();
        
        uint256 len = importedBasket.bassets.length;
        uint256[] memory scaledVaultBalances = new uint256[](len);
        uint256 totalScaledBalance = 0;
        for (uint8 i = 0; i < len; i++) {
            Basset memory bAsset = importedBasket.bassets[i];
            uint128 ratio = SafeCast.toUint128(bAsset.ratio);
            uint128 vaultBalance = SafeCast.toUint128(bAsset.vaultBalance);
            // caclulate scaled vault bAsset balance and total vault balance
            uint128 scaledVaultBalance = (vaultBalance * ratio) / 1e8;
            scaledVaultBalances[i] = scaledVaultBalance;
            totalScaledBalance += scaledVaultBalance;
            console.log("bAsset[%s] ratio %s, scaledVaultBalance %s", i, ratio, scaledVaultBalance);
        }
        // Target is 1/3
        targetScaledBalance = totalScaledBalance / 3;
        console.log("target balance %s", targetScaledBalance);

        // Assume sUSD is under target all all others are over the target
        differentToTargetScaled = new int128[](len);

        // For each bAssets
        for (uint8 i = 0; i < 5; i++) {
            // If sUSD or TUSD
            if (i == 0 || i == 2) {
                // Target is zero so they are over weight by their balance
                differentToTargetScaled[i] = SafeCast.toInt128(SafeCast.toInt256(scaledVaultBalances[i]));
            // USDC, USDT or DAI
            } else {
                // current balance - target balance
                differentToTargetScaled[i] =
                    SafeCast.toInt128(SafeCast.toInt256(scaledVaultBalances[i])) -
                    SafeCast.toInt128(SafeCast.toInt256(targetScaledBalance));
            }
        }
    }

    function getFlashloan(address flashToken, uint256 flashAmount) internal {
        uint256 balanceBefore = IERC20(flashToken).balanceOf(address(this));
        bytes memory data = abi.encode(flashToken, flashAmount, balanceBefore);
        flashloan(flashToken, flashAmount, data); // execution goes to `callFunction`
        // and this point we have succefully repaid the flash loan
    }

    function callFunction(
        address, /* sender */
        Info calldata, /* accountInfo */
        bytes calldata data
    ) external onlyPool {
        (address flashToken, uint256 flashAmount, uint256 balanceBefore) = abi
            .decode(data, (address, uint256, uint256));
        uint256 balanceAfter = IERC20(flashToken).balanceOf(address(this));
        require(
            balanceAfter - balanceBefore == flashAmount,
            "contract did not get the loan"
        );

        uint256 swap1Output;
        uint256 swap2Output;

        if (flashToken == USDC)
        {
            // Balance USDC
            // Approve mUSD contract to transfer 2m USDC from this contract
            IERC20(USDC).approve(address(mUsdV2), 2e12);
            // Swap 2m USDC for TUSD using mUSD to balance USDC and some of TUSD
            mUsdV2.swap(USDC, TUSD, 2e12, address(this));

            // Balance USDT
            // Approve Curve 3pool to transfer 1.3m USDC from this contract
            IERC20(USDC).approve(address(curve3pool), 13e11);
            // Swap 1.3m USDC (6 decimals) for USDT (6 decimals) using Curve 3pool
            curve3pool.exchange(1, 2, 13e11, 12e11);
            // Get USDT balance from the last Curve swap
            swap1Output = IUSDT(USDT).balanceOf(address(this));
            uint256 remainingTusdBalance = IERC20(TUSD).balanceOf(address(mUsdV2));
            // uint256 usdtTusdInput = swap1Output < remainingTusdBalance ? swap1Output : remainingTusdBalance;
            console.log("USDT output %s, remaining TUSD in mUSD %s", swap1Output, remainingTusdBalance);
            // Approve mUSD contract to transfer 1.3m USDT from this contract
            IUSDT(USDT).approve(address(mUsdV2), swap1Output);
            // Swap 1.3m USDT for TUSD using mUSD to balance USDT and some of TUSD
            mUsdV2.swap(USDT, TUSD, swap1Output, address(this));

            // Convert TUSD back to USDC to repay DyDx flash loan
            // Get current TUSD balance from USDC and USDT swaps to TUSD
            uint256 currentTusdBalance = IERC20(TUSD).balanceOf(address(this));
            // Approve Curve Ypool to transfer all TUSD from this contract
            IERC20(TUSD).approve(address(curveYpool), currentTusdBalance);
            // Swap TUSD for USDC using Curve Y pool
            curveYpool.exchange_underlying(3, 1, currentTusdBalance, 0);
        }
        else if (flashToken == DAI)
        {
            // Approve mUSD contract to transfer 15.5m DAI from this contract
            IERC20(DAI).approve(address(mUsdV2), flashAmount);
            // Swap 15.5m DAI for TUSD using mUSD to balance DAI and TUSD
            mUsdV2.swap(DAI, TUSD, flashAmount, address(this));

            // Convert TUSD back to DAI to repay DyDx flash loan
            // Get TUSD balance from the last mUSD swap
            swap1Output = IERC20(TUSD).balanceOf(address(this));
            // Approve Curve Y pool to transfer all TUSD from this contract
            IERC20(TUSD).approve(address(curveYpool), swap1Output);

            // Swap 1st half TUSD for DAI using Curve Y pool
            uint256 halfTusd = swap1Output / 2;
            // Convert 18 decimals to 6 decimals hence div by 12
            uint256 minOutput = halfTusd * 98 / 100 / 1e12;
            curveYpool.exchange_underlying(3, 0, halfTusd, minOutput);

            // Swap 2nd half TUSD for USDC using Curve Y pool
            console.log("Before swapped TUSD for USDC using Curve Y pool. swap1Output %s, halfTusd %s, minOutput %s", swap1Output, halfTusd, minOutput);
            curveYpool.exchange_underlying(3, 1, halfTusd, minOutput);
            console.log("After swapped TUSD for USDC using Curve Y pool");
            // Swap USDC for DAI using Curve 3pool
            uint256 usdcBalance = IERC20(USDC).balanceOf(address(this));
            // Approve Curve 3pool to transfer all USDC from this contract
            IERC20(USDC).approve(address(curve3pool), usdcBalance);
            curve3pool.exchange(1, 0, usdcBalance, 0);
        }

        // Caculate flash loan shortfall
        uint256 flashTokenBalance = IERC20(flashToken).balanceOf(address(this));
        // Need to add 2 wei to cover the cost of the DyDx flash loan. Using 10 just to avoid rounding issues
        uint256 flashLoanShortfall = flashAmount - flashTokenBalance + 10;

        // Transfer flash loan shortfall to this contract from funded account
        console.log("loan shortfall %s", flashLoanShortfall);
        uint256 funderAllowance = IERC20(flashToken).allowance(funderAccount, address(this));
        require(funderAllowance > flashLoanShortfall, "funder allowance < shortfall");
        uint256 funderBalance = IERC20(flashToken).balanceOf(funderAccount);
        require(funderBalance > flashLoanShortfall, "funder balance < shortfall");
        IERC20(flashToken).transferFrom(funderAccount, address(this), flashLoanShortfall);
        console.log("flashLoanShortfall %s", flashLoanShortfall);

        emit Balance(flashToken, flashAmount, swap1Output, flashTokenBalance, flashLoanShortfall);

        // the calling DyDx flash loan contract with now repay the flash loan with a transfer from this contract
    }
}
