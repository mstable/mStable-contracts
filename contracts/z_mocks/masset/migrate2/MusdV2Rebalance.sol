// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// import "hardhat/console.sol";

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import { IMassetV1 } from "./IMassetV1.sol";
import { DyDxFlashLoan } from "../../../peripheral/dydx/DyDxFlashLoan.sol";
import { ICurve } from "../../../peripheral/Curve/ICurve.sol";

/**
 * @title   Contract to rebalance mUSD bAssets to new weights for the mUSD V3 upgrade.
 * @author  mStable
 * @notice  Either DAI or USDC is flash loaned from DyDx to swap for TUSD or USDT in mUSD.
 *          Curve's TUSD pool (DAI, USDC, USDT and TUSD) or 3pool (DAI, USDC, USDT) is used to
 *          convert TUSD and USDT back to the flash loan currency.
 * @dev     VERSION: 1.0
 *          DATE:    2021-03-22
 */
contract MusdV2Rebalance is DyDxFlashLoan, Ownable {
    using SafeERC20 for IERC20;

    // Contracts that are called to execute swaps
    IMassetV1 constant mUsdV1 = IMassetV1(0xe2f2a5C287993345a840Db3B0845fbC70f5935a5);
    ICurve constant curve3pool = ICurve(0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7);
    ICurve constant curveYpool = ICurve(0x45F783CCE6B7FF23B2ab2D70e416cdb7D6055f51);
    ICurve constant curveTUSDpool = ICurve(0xEcd5e75AFb02eFa118AF914515D6521aaBd189F1);

    event FlashLoan(
        address flashToken,
        uint256 flashLoanAmount,
        address funderAccount,
        uint256 flashLoanShortfall
    );

    // Events from dependant contracts so Ethers can parse the topics
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    // mUSD
    event Swapped(
        address indexed swapper,
        address input,
        address output,
        uint256 outputAmount,
        address recipient
    );
    // Curve
    event TokenExchange(
        address indexed buyer,
        int128 sold_id,
        uint256 tokens_sold,
        int128 bought_id,
        uint256 tokens_bought
    );
    event TokenExchangeUnderlying(
        address indexed buyer,
        int128 sold_id,
        uint256 tokens_sold,
        int128 bought_id,
        uint256 tokens_bought
    );

    /***************************************
                Swap (PUBLIC)
    ****************************************/

    /**
     * @notice Convert TUSD in the mUSD basket to USDC or DAI using a DyDx flash loan.
     * @param flashToken DAI or USDC token address.
     * @param flashAmount Amount to flash loan. For USDC is 6 decimal places. DAI is 18 decimals places.
     * @param funderAccount Account that will fund the shortfall of the DyDx USDC flash loan.
     * @dev Assumes the funder has already approved this contract to transferFrom the shortfall from their account.
     */
    function swapOutTusd(
        address flashToken,
        uint256 flashAmount,
        address funderAccount
    ) external onlyOwner {
        uint256[] memory swapInputs = new uint256[](2);
        swapInputs[0] = flashAmount;
        _getFlashloan(flashToken, funderAccount, swapInputs);
    }

    /**
     * @notice Convert TUSD and USDT in the mUSD basket to USDC or DAI using a DyDx flash loan.
     * @param flashToken DAI or USDC token address.
     * @param funderAccount Account that will fund the shortfall of the DyDx USDC flash loan.
     * @param swapInputs This mUSD swap inputs from the flash token to TUSD (at index 0) and USDT (at index 1).
     * @dev Assumes the funder has already approved this contract to transferFrom the shortfall from their account.
     */
    function swapOutTusdAndUsdt(
        address flashToken,
        uint256, /*flashAmount*/
        address funderAccount,
        uint256[] memory swapInputs
    ) external onlyOwner {
        _getFlashloan(flashToken, funderAccount, swapInputs);
    }

    /***************************************
                DyDx Flash Loan (Internal)
    ****************************************/

    /**
     * @notice Requests a flash loan from DyDx.
     * @param flashToken DAI or USDC token address.
     * @param funderAccount Account that will fund the shortfall of the DyDx USDC flash loan.
     * @param swapInputs This mUSD swap inputs from the flash token to TUSD (at index 0) and USDT (at index 1).
     */
    function _getFlashloan(
        address flashToken,
        address funderAccount,
        uint256[] memory swapInputs
    ) internal {
        uint256 balanceBefore = IERC20(flashToken).balanceOf(address(this));
        bytes memory data = abi.encode(flashToken, balanceBefore, funderAccount, swapInputs);
        uint256 flashAmount = swapInputs[0] + swapInputs[1];
        // console.log("About to flash loan %s %s from DyDx", flashAmount, flashToken);
        flashloan(flashToken, flashAmount, data); // execution goes to `callFunction`
        // and this point we have succefully repaid the flash loan
    }

    /***************************************
                DyDx Flash Loan (Public)
    ****************************************/

    /**
     * Is called by DyDx after the flash loan has been transferred to this contract.
     */
    function callFunction(
        address, /* sender */
        Info calldata, /* accountInfo */
        bytes calldata data
    ) external onlyPool {
        (
            address flashToken,
            uint256 balanceBefore,
            address funderAccount,
            uint256[] memory swapInputs
        ) = abi.decode(data, (address, uint256, address, uint256[]));
        uint256 balanceAfter = IERC20(flashToken).balanceOf(address(this));
        require(
            balanceAfter - balanceBefore == swapInputs[0] + swapInputs[1],
            "did not get flash loan"
        );

        _balanceTusdAndUsdt(flashToken, funderAccount, swapInputs);

        // the calling DyDx flash loan contract with now repay the flash loan with a transfer from this contract
    }

    /***************************************
                Swap (Internal)
    ****************************************/

    /**
     * @notice Executes the following swaps to rebalance the mUSD bAssets:
        Swap flash token for TUSD using mUSD
        Swap flash token for USDT using mUSD
        Swap TUSD for flash token using Curve TUSD pool (can be further split across Curve 3pool)
        Swap USDT for flash token using Curve 3pool
        Fund the DyDx flash loan shortfall
     * @param flashToken DAI or USDC token address.
     * @param funderAccount Account that will fund the shortfall of the DyDx USDC flash loan.
     * @param swapInputs This mUSD swap inputs from the flash token to TUSD (at index 0) and USDT (at index 1).
     */
    function _balanceTusdAndUsdt(
        address flashToken,
        address funderAccount,
        uint256[] memory swapInputs
    ) internal {
        uint256 flashAmount = swapInputs[0] + swapInputs[1];
        // Approve mUSD contract to transfer flash token from this contract
        // console.log("About to approve mUSD contract to transfer %s flash tokens >= %s %s", flashAmount, swapInputs[0], swapInputs[1]);
        require(flashAmount >= swapInputs[0] + swapInputs[1], "flash loan not >= swap inputs");
        IERC20(flashToken).safeApprove(address(mUsdV1), flashAmount);

        // If swapping flash token into mUSD for TUSD
        if (swapInputs[0] > 0) {
            // Swap flash token for TUSD using mUSD
            // console.log("About to mUSD swap %s flash tokens for TUSD", swapInputs[0]);
            uint256 tusdOutput = mUsdV1.swap(flashToken, TUSD, swapInputs[0], address(this));
            // console.log("tusdOutput %s", tusdOutput);

            uint256 halfTusdOutput = tusdOutput / 2;

            // Convert TUSD back to flash token to repay DyDx flash loan

            // Curve Y pool
            // Approve Curve Y pool to transfer all TUSD from this contract
            IERC20(TUSD).safeApprove(address(curveYpool), halfTusdOutput);

            // Swap TUSD for flash token using Curve TUSD pool
            uint256 minOutput = (halfTusdOutput * 99) / 100;
            int128 outputIndex = 0; // DAI
            if (flashToken == USDC) {
                outputIndex = 1;
                // Converting from TUSD with 18 decimals to USDC with 6 decimals
                minOutput = minOutput / 1e12;
            }
            // console.log("About to swap on Curve Y pool %s TUSD (3) for flash loan (%s)", halfTusdOutput, outputIndex);
            curveYpool.exchange_underlying(3, outputIndex, halfTusdOutput, minOutput);
            // console.log("Curve TUSD pool swap");

            // Curve TUSD pool
            // Approve Curve TUSD pool to transfer all TUSD from this contract
            IERC20(TUSD).safeApprove(address(curveTUSDpool), halfTusdOutput);

            // Swap TUSD for flash token using Curve TUSD pool
            minOutput = (halfTusdOutput * 99) / 100;
            outputIndex = 1; // DAI
            if (flashToken == USDC) {
                outputIndex = 2;
                // Converting from TUSD with 18 decimals to USDC with 6 decimals
                minOutput = minOutput / 1e12;
            }
            // console.log("About to swap on Curve TUSD pool %s TUSD (0) for flash loan (%s)", halfTusdOutput, outputIndex);
            curveTUSDpool.exchange_underlying(0, outputIndex, halfTusdOutput, minOutput);
            // console.log("Curve TUSD pool swap");
        }

        // If swapping flash token into mUSD for USDT
        if (swapInputs[1] > 0) {
            // Swap flash token for USDT using mUSD
            // console.log("About to mUSD swap %s flash tokens for USDT", swapInputs[1]);
            uint256 usdtOutput = mUsdV1.swap(flashToken, USDT, swapInputs[1], address(this));
            // console.log("usdtOutput %s", usdtOutput);

            // Convert USDT for flash token using Curve 3pool
            // Approve Curve 3pool to transfer all USDT from this contract
            IERC20(USDT).safeApprove(address(curve3pool), usdtOutput);

            // Swap USDT for flash token using Curve 3pool
            uint256 minOutput = (usdtOutput * 99) / 100;
            int128 outputIndex = 1; // USDC
            if (flashToken == DAI) {
                outputIndex = 0;
                // Converting from USDT with 6 decimals to DAI with 18 decimals
                minOutput = ((minOutput * 99) / 100) * 1e12;
            }
            curve3pool.exchange(2, outputIndex, usdtOutput, minOutput);
            // console.log("Curve 3pool swap");
        }

        _fundLoanShortfall(flashToken, flashAmount, funderAccount);
    }

    /**
     * @notice Calculates how much the flash loan is short before repayment.
               Funds the loan shortfall from a nominated funder account.
     * @param flashToken DAI or USDC token address.
     * @param flashAmount Amount to flash loan. For USDC is 6 decimal places. DAI is 18 decimals places.
     * @param funderAccount Account that will fund the shortfall of the DyDx USDC flash loan.
     */
    function _fundLoanShortfall(
        address flashToken,
        uint256 flashAmount,
        address funderAccount
    ) internal {
        // Caculate flash loan shortfall
        uint256 flashTokenBalance = IERC20(flashToken).balanceOf(address(this));
        uint256 flashLoanShortfall;
        if (flashAmount + 10 > flashTokenBalance) {
            // Need to add 2 wei to cover the cost of the DyDx flash loan.
            // using 1000000 wei just to be safe.
            flashLoanShortfall = flashAmount + 1000000 - flashTokenBalance;

            // Transfer flash loan shortfall to this contract from funded account
            uint256 funderAllowance = IERC20(flashToken).allowance(funderAccount, address(this));
            // console.log("funderAllowance %s > flashLoanShortfall %s", funderAllowance, flashLoanShortfall);
            require(funderAllowance > flashLoanShortfall, "funder allowance < shortfall");
            uint256 funderBalance = IERC20(flashToken).balanceOf(funderAccount);
            // console.log("funderBalance %s > flashLoanShortfall %s", funderBalance, flashLoanShortfall);
            require(funderBalance > flashLoanShortfall, "funder balance < shortfall");
            // console.log("flashLoanShortfall %s", flashLoanShortfall);

            // Loan shortfall can not be more than 30k
            uint256 maxShortfall;
            if (flashToken == DAI) maxShortfall = 30000e18; // 18 decimal places
            if (flashToken == USDC) maxShortfall = 30000e6; // 6 decimal places
            require(flashLoanShortfall <= maxShortfall, "flashLoanShortfall too big");

            // console.log("About to fund flash loan shortfall from funder");
            IERC20(flashToken).safeTransferFrom(funderAccount, address(this), flashLoanShortfall);
            // console.log("shortfall has been repaid");
        }

        emit FlashLoan(flashToken, flashAmount, funderAccount, flashLoanShortfall);
    }
}
