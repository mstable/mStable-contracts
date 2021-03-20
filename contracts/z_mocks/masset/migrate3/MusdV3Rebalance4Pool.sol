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
    address constant aaveV1 = 0x3dfd23A6c5E8BbcFc9581d2E864a68feb6a076d3;
    address constant aaveVaultV1 = 0xf617346A0FB6320e9E578E0C9B2A4588283D9d39;


    event FlashLoan(
        address flashToken,
        uint256 flashLoanAmount,
        address funderAccount,
        uint256 flashLoanShortfall);

    // Events from dependant contracts so Ethers can parse the topics
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    // mUSD
    event Swapped(address indexed swapper, address input, address output, uint256 outputAmount, address recipient);
    // Curve
    event TokenExchange(address indexed buyer, int128 sold_id, uint256 tokens_sold, int128 bought_id, uint256 tokens_bought);
    event TokenExchangeUnderlying(address indexed buyer, int128 sold_id, uint256 tokens_sold, int128 bought_id, uint256 tokens_bought);

    constructor() {
        owner = msg.sender;
    }

    // Entry point to rebalance mUSD bAssets
    function rebalance(address funderAccount) external {
        require(msg.sender == owner, "not owner");

        // Calculate swaps to balance mUSD
        int128[] memory differentToTargetScaled = getSwapAmounts();

        // TODO Flash loan USDC from DyDx to balance TUSD and USDT
        require(differentToTargetScaled[1] < 0, "USDC is over weight");
        uint256 usdcLoanAmount = SafeCast.toUint256(differentToTargetScaled[1] * -1 / 1e12);
        console.log("USDC loan amount %s", usdcLoanAmount);
        // getFlashloan(USDC, usdcLoanAmount, funderAccount);

        // TODO Flash loan DAI from DyDx to balance TUSD and USDT
    }

    /**
     * Convert TUSD in the mUSD basket to USDC or DAI using a DyDx flash loan
     * @param flashToken DAI or USDC token address
     * @param flashAmount Amount to flash loan. For USDC is 6 decimal places. DAI is 18 decimals places.
     * @param funderAccount account that will fund the shortfall of the DyDx USDC flash loan
     * @dev assumes the funder has already approved this contract to transferFrom the shortfall from their account.
     */
    function swapOutTusd(address flashToken, uint256 flashAmount, address funderAccount) external {
        require(msg.sender == owner, "not owner");

        uint256[] memory swapInputs = new uint256[](2);
        swapInputs[0] = flashAmount;
        getFlashloan(flashToken, flashAmount, funderAccount, swapInputs);
    }

    /**
     * Convert TUSD and USDT in the mUSD basket to USDC or DAI using a DyDx flash loan
     * @param flashToken DAI or USDC token address
     * @param flashAmount Amount to flash loan. For USDC is 6 decimal places. DAI is 18 decimals places.
     * @param funderAccount account that will fund the shortfall of the DyDx USDC flash loan
     * @param swapInputs this mUSD swap inputs from the flash token to TUSD (at index 0) and USDT (at index 1) 
     * @dev assumes the funder has already approved this contract to transferFrom the shortfall from their account.
     */
    function swapOutTusdAndUsdt(address flashToken, uint256 flashAmount, address funderAccount, uint256[] memory swapInputs) external {
        require(msg.sender == owner, "not owner");

        getFlashloan(flashToken, flashAmount, funderAccount, swapInputs);
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

    function getFlashloan(address flashToken, uint256 flashAmount, address funderAccount, uint256[] memory swapInputs) internal {
        uint256 balanceBefore = IERC20(flashToken).balanceOf(address(this));
        bytes memory data = abi.encode(flashToken, flashAmount, balanceBefore, funderAccount, swapInputs);
        flashloan(flashToken, flashAmount, data); // execution goes to `callFunction`
        // and this point we have succefully repaid the flash loan
    }

    function callFunction(
        address, /* sender */
        Info calldata, /* accountInfo */
        bytes calldata data
    ) external onlyPool {
        (address flashToken, uint256 flashAmount, uint256 balanceBefore, address funderAccount, uint256[] memory swapInputs) = abi
            .decode(data, (address, uint256, uint256, address, uint256[]));
        uint256 balanceAfter = IERC20(flashToken).balanceOf(address(this));
        require(
            balanceAfter - balanceBefore == flashAmount,
            "did not get flash loan"
        );

        balanceTusdAndUsdt(flashToken, flashAmount, funderAccount, swapInputs);

        // the calling DyDx flash loan contract with now repay the flash loan with a transfer from this contract
    }

    /**
     Swap flash token for TUSD using mUSD
     Swap flash token for USDT using mUSD
     Swap TUSD for flash token using Curve Y pool (can be further split across Curve 3pool)
     Swap USDT for flash token using Curve 3pool
     Fund the DyDx flash loan shortfall
     */
    function balanceTusdAndUsdt(address flashToken, uint256 flashAmount, address funderAccount, uint256[] memory swapInputs) internal {
        // Approve mUSD contract to transfer USDC from this contract
        IERC20(flashToken).approve(address(mUsdV2), flashAmount);

        // If swapping flash token into mUSD for TUSD
        if (swapInputs[0] > 0) {
            // Swap flash token for TUSD using mUSD
            uint256 tusdOutput = mUsdV2.swap(flashToken, TUSD, swapInputs[0], address(this));

            // Convert TUSD back to flash token to repay DyDx flash loan
            // Approve Curve Y pool to transfer all TUSD from this contract
            IERC20(TUSD).approve(address(curveYpool), tusdOutput);

            // Swap TUSD for flash token using Curve Y pool
            uint256 minOutput = tusdOutput * 99 / 100;
            if (flashToken == USDC) {
                // Converting from TUSD with 18 decimals to USDC with 6 decimals
                minOutput = minOutput / 1e12;
            }
            curveYpool.exchange_underlying(3, 1, tusdOutput, minOutput);
        }

        // If swapping flash token into mUSD for USDT
        if (swapInputs[1] > 0) {
            // Swap flash token for USDT using mUSD
            uint256 usdtOutput = mUsdV2.swap(flashToken, USDT, swapInputs[1], address(this));

            // Convert USDT for flash token using Curve 3pool
            // Approve Curve 3pool to transfer all USDT from this contract
            IUSDT2(USDT).approve(address(curve3pool), usdtOutput);

            // Swap USDT for flash token using Curve 3pool
            uint256 minOutput = usdtOutput * 99 / 100;
            if (flashToken == DAI) {
                // Converting from USDT with 6 decimals to DAI with 18 decimals
                minOutput = minOutput * 1e12;
            }
            curve3pool.exchange(2, 1, usdtOutput, minOutput);
        }

        fundLoanShortfall(USDC, flashAmount, funderAccount);
    }

    function fundLoanShortfall(address flashToken, uint256 flashAmount, address funderAccount) internal {
        // Caculate flash loan shortfall
        uint256 flashTokenBalance = IERC20(flashToken).balanceOf(address(this));
        uint256 flashLoanShortfall;
        if (flashAmount + 2 > flashTokenBalance) {
            // Need to add 2 wei to cover the cost of the DyDx flash loan.
            flashLoanShortfall = flashAmount + 2 - flashTokenBalance;

            // Transfer flash loan shortfall to this contract from funded account
            uint256 funderAllowance = IERC20(flashToken).allowance(funderAccount, address(this));
            require(funderAllowance > flashLoanShortfall, "funder allowance < shortfall");
            uint256 funderBalance = IERC20(flashToken).balanceOf(funderAccount);
            require(funderBalance > flashLoanShortfall, "funder balance < shortfall");
            IERC20(flashToken).transferFrom(funderAccount, address(this), flashLoanShortfall);
        }
        
        emit FlashLoan(flashToken, flashAmount, funderAccount, flashLoanShortfall);
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
