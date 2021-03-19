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

interface IUSDT2 {
    function approve(address spender, uint256 amount) external;
    function balanceOf(address) external returns (uint256);
}

/**
 Contract to rebalance mUSD bAssets to new weights for the mUSD V3 upgrade.
 Either DAI or USDC is flash loaned from DyDx to swap for TUSD or USDT in mUSD.
 Curve's Y pool (DAI, USDC, USDT and TUSD) or 3pool (DAI, USDC, USDT) is used to
 convert TUSD and USDT back to the flash loan currency.
 */
contract MusdV3Rebalance4Pool is DyDxFlashLoan {

    using SafeERC20 for IERC20;

    // TODO make immutable and set in constructor
    address constant daiFunderAccount = 0xF977814e90dA44bFA03b6295A0616a897441aceC;
    address constant susdFunderAccount = 0x8cA24021E3Ee3B5c241BBfcee0712554D7Dc38a1;

    address immutable private owner;
    MusdV3 constant mUsdV3 = MusdV3(0xe2f2a5C287993345a840Db3B0845fbC70f5935a5);
    IMassetV2 constant mUsdV2 = IMassetV2(0xe2f2a5C287993345a840Db3B0845fbC70f5935a5);
    IBasketManager constant basketManager = IBasketManager(0x66126B4aA2a1C07536Ef8E5e8bD4EfDA1FdEA96D);
    ICurve constant curve3pool = ICurve(0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7);
    ICurve constant curveYpool = ICurve(0x45F783CCE6B7FF23B2ab2D70e416cdb7D6055f51);
    address constant aaveVault = 0xf617346A0FB6320e9E578E0C9B2A4588283D9d39;

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

    // Entry point to rebalance mUSD bAssets
    function rebalance() external {
        require(msg.sender == owner, "not owner");

        // Calculate swaps to balance mUSD
        int128[] memory differentToTargetScaled = getSwapAmounts();

        // For block 12000000
        // Flash loan DAI from DyDx to balance DAI using TUSD
        // require(differentToTargetScaled[4] < 0, "DAI is over weight");
        // getFlashloan(DAI, SafeCast.toUint256(differentToTargetScaled[4] * -1));
        // address[] memory bAssets = new address[](3);
        // uint256[] memory amounts = new uint256[](3);
        // bAssets[0] = USDC;
        // bAssets[1] = USDT;
        // bAssets[2] = TUSD;
        // amounts[0] = SafeCast.toUint256(differentToTargetScaled[1]);
        // amounts[1] = SafeCast.toUint256(differentToTargetScaled[3]);
        // amounts[2] = SafeCast.toUint256(differentToTargetScaled[2]);

        // For block 12040000
        // Swap sUSD for TUSD
        address[] memory bAssets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bAssets[0] = TUSD;
        amounts[0] = SafeCast.toUint256(differentToTargetScaled[0] * -1);
        balanceSusd(bAssets, amounts);

        // Flash loan USDC from DyDx to balance TUSD and some USDC
        require(differentToTargetScaled[1] < 0, "USDC is over weight");
        uint256 usdcLoanAmount = SafeCast.toUint256(differentToTargetScaled[1] * -1 / 1e12);
        console.log("USDC loan amount %s", usdcLoanAmount);
        // Need to convert scaled 18 decimals to USDC's 6 decimals
        getFlashloan(USDC, usdcLoanAmount);
    }

    /**
     * Calculates the amount a bAsset is over or under the target weight
     */
    function getSwapAmounts() public returns (
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
        // Target is 1/4 (25%)
        uint256 targetScaledBalance = totalScaledBalance / 4;
        console.log("target balance %s", targetScaledBalance);

        differentToTargetScaled = new int128[](len);

        // For each bAssets
        for (uint8 i = 0; i < len; i++) {
            // diff to target = current balance - target balance
            differentToTargetScaled[i] =
                SafeCast.toInt128(SafeCast.toInt256(scaledVaultBalances[i])) -
                SafeCast.toInt128(SafeCast.toInt256(targetScaledBalance));
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

        // For block 12000000
        // balanceDAIforTUSD(flashToken, flashAmount);

        // For block 12040000
        if (flashToken == USDC) {
            balanceTusdUsdc(flashToken, flashAmount);
        }

        // the calling DyDx flash loan contract with now repay the flash loan with a transfer from this contract
    }

    /**
     Executes the following rebalance strategy as block 12040000
     Swap 9.15m USDC for TUSD using mUSD to balance TUSD
     Swap 11.45 - 9.15 = 2.3m USDC for USDT using mUSD to balance USDC
     Swap 9.15m TUSD for USDC using Curve Y pool (can be further split)
     Swap 2.3m USDT for USDC using Curve 3pool
     */
    function balanceTusdUsdc(address flashToken, uint256 flashAmount) internal {
        // Approve mUSD contract to transfer  11.7m USDC from this contract
        IERC20(USDC).approve(address(mUsdV2), flashAmount);

        // Swap 7.03m USDC for TUSD using mUSD to balance USDC
        uint256 swapInput = IERC20(TUSD).balanceOf(aaveVault) / 1e12;
        console.log("%s TUSD left in mUSD to 12 decimals", swapInput);
        // swapInput = 703e10 * 1e12;
        mUsdV2.swap(USDC, TUSD, swapInput, address(this));
        // Swap 2.3m USDC for USDT using mUSD to balance USDC
        swapInput = flashAmount - swapInput; 
        mUsdV2.swap(USDC, USDT, swapInput, address(this));

        // Convert TUSD back to USDC to repay DyDx flash loan
        // Get TUSD balance from the last mUSD swap
        uint256 swap1Output = IERC20(TUSD).balanceOf(address(this));
        // Approve Curve Y pool to transfer all TUSD from this contract
        IERC20(TUSD).approve(address(curveYpool), swap1Output);

        // Swap TUSD for USDC using Curve Y pool
        // Converting from TUSD with 18 decimals to USDC with 6 decimals
        uint256 minOutput = swap1Output * 99 / 100 / 1e12;
        curveYpool.exchange_underlying(3, 1, swap1Output, minOutput);

        // Convert USDT back to USDC to repay DyDx flash loan
        // Get USDT balance from the last mUSD swap
        uint256 swap2Output = IUSDT2(USDT).balanceOf(address(this));
        // Approve Curve 3pool to transfer all USDT from this contract
        IUSDT2(USDT).approve(address(curve3pool), swap2Output);

        // Swap 2.3m USDT for USDC using Curve 3pool
        minOutput = swap2Output * 99 / 100;
        curve3pool.exchange(2, 1, swap2Output, minOutput);

        fundLoanShortfall(flashToken, flashAmount, swap1Output);
    }

    /**
    Executes the following rebalance strategy as block 12000000
    Flash loan 11.6m DAI from DyDx
    Swap 11.6 DAI for TUSD using mUSD to balance DAI
    Swap 7.8 TUSD for DAI using Curve Y pool
    Swap 7.8 TUSD for USDC using Curve Y pool
    Swap 7.8 USDC for DAI using Curve 3 pool
    Fund DAI loan shortfall 
    Repay 11.6m DAI flash loan from DyDx
    */
    function balanceDAIforTUSD(address flashToken, uint256 flashAmount) internal {
        uint256 swap1Output;

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
        uint256 minOutput = halfTusd * 99 / 100;
        curveYpool.exchange_underlying(3, 0, halfTusd, minOutput);

        // Swap 2nd half TUSD for USDC using Curve Y pool
        // Convert 18 decimals to 6 decimals hence div by 12
        minOutput = minOutput / 1e12;
        console.log("Before swapped TUSD for USDC using Curve Y pool. swap1Output %s, halfTusd %s, minOutput %s", swap1Output, halfTusd, minOutput);
        curveYpool.exchange_underlying(3, 1, halfTusd, minOutput);
        console.log("After swapped TUSD for USDC using Curve Y pool");
        // Swap USDC for DAI using Curve 3pool
        uint256 usdcBalance = IERC20(USDC).balanceOf(address(this));
        // Approve Curve 3pool to transfer all USDC from this contract
        IERC20(USDC).approve(address(curve3pool), usdcBalance);
        curve3pool.exchange(1, 0, usdcBalance, 0);

        fundLoanShortfall(flashToken, flashAmount, swap1Output);
    }

    function fundLoanShortfall(address flashToken, uint256 flashAmount, uint256 swap1Output) internal {
        // Caculate flash loan shortfall
        uint256 flashTokenBalance = IERC20(flashToken).balanceOf(address(this));
        uint256 flashLoanShortfall;
        console.log("flashAmount %s > flashTokenBalance %s - 2", flashAmount, flashTokenBalance);
        if (flashAmount + 2 > flashTokenBalance) {
            // Need to add 2 wei to cover the cost of the DyDx flash loan.
            flashLoanShortfall = flashAmount + 2 - flashTokenBalance;

            // Transfer flash loan shortfall to this contract from funded account
            console.log("loan shortfall %s", flashLoanShortfall);
            uint256 funderAllowance = IERC20(flashToken).allowance(daiFunderAccount, address(this));
            require(funderAllowance > flashLoanShortfall, "funder allowance < shortfall");
            uint256 funderBalance = IERC20(flashToken).balanceOf(daiFunderAccount);
            require(funderBalance > flashLoanShortfall, "funder balance < shortfall");
            IERC20(flashToken).transferFrom(daiFunderAccount, address(this), flashLoanShortfall);
            console.log("flashLoanShortfall %s", flashLoanShortfall);
        }
        
        emit Balance(flashToken, flashAmount, swap1Output, flashTokenBalance, flashLoanShortfall);
    }
    
    /**
    * @notice balances mUSD bAssets using sUSD.
    * Assumes the sUSD funding account has already approved a transfer to this contract.
    * @dev this function can be simplified if there is only one bAsset to swap for sUSD
    * at the time of the mUSD upgrade.
    */
    function balanceSusd(address[] memory bAssets, uint256[] memory amounts) internal {
        // sum the total sUSD to be swapped on mUSD
        uint256 len = bAssets.length;
        uint256 sUsdTotal;
        for (uint256 i = 0; i < len; i++) {
            sUsdTotal += amounts[i];
        }

        // transfer sUSD to this contract
        console.log("borrow %s sUSD", sUsdTotal);
        uint256 funderAllowance = IERC20(sUSD).allowance(susdFunderAccount, address(this));
        require(funderAllowance > sUsdTotal, "funder allowance < borrow amount");
        uint256 funderBalance = IERC20(sUSD).balanceOf(susdFunderAccount);
        require(funderBalance > sUsdTotal, "funder balance < borrow amount");
        IERC20(sUSD).transferFrom(susdFunderAccount, address(this), sUsdTotal);

        // Approve mUSD contract to transfer sUSD from this contract
        IERC20(sUSD).approve(address(mUsdV2), sUsdTotal);

        // Swap sUSD for bAsset using mUSD to balance the bAsset
        for (uint256 i = 0; i < len; i++) {
            mUsdV2.swap(sUSD, bAssets[i], amounts[i], address(this));
        }

        // Currently not converting the bAsset back to sUSD
    }
}
