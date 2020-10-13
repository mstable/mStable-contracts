pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { IUniswapV2Router02 } from "./IUniswapV2Router02.sol";
import { ICERC20 } from "../platform-integrations/ICompound.sol";
import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableModule } from "../../shared/InitializableModule.sol";
import { MassetHelpers } from "../../masset/shared/MassetHelpers.sol";

import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   Liquidator
 * @author  Stability Labs Pty. Ltd.
 * @notice  The Liquidator allows rewards to be swapped for another token
 *          and returned to a calling contract
 * @dev     VERSION: 1.0
 *          DATE:    2020-10-13
 */
contract Liquidator is
    Initializable,
    InitializableModule
{
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event LiquidationModified(address indexed integration);
    event LiquidationEnded(address indexed integration);
    event Liquidated(address indexed sellToken, address buyToken, uint256 buyAmount);

    address public uniswapAddress;
    uint256 public interval = 1 days;

    mapping(address => Liquidation) public liquidations;

    enum LendingPlatform { Null, Compound, Aave }

    struct Liquidation {
        LendingPlatform platform;
        address sellToken;
        address bAsset;
        address[] uniswapPath;
        uint256 lastTriggered;
        uint256 trancheAmount;
    }

    /** @dev Constructor */
    function initialize(
        address _nexus,
        address _uniswapAddress
    )
        external
        initializer
    {
        InitializableModule._initialize(_nexus);

        uniswapAddress = _uniswapAddress;
    }

    /***************************************
                    GOVERNANCE
    ****************************************/

    /**
    * @dev Create a liquidation
    * @param _integration The integration contract address for the _bAsset
    * @param _lendingPlatform The lending platform to use for the deposit
    * @param _sellToken The integration contract address for the _bAsset
    * @param _bAsset The _bAsset address that this liquidation is for
    * @param _uniswapPath The Uniswap path as an array of addresses e.g. [COMP, WETH, DAI]
    * @param _trancheAmount The amount of tokens to be sold when triggered
    */
    function createLiquidation(
        address _integration,
        LendingPlatform _lendingPlatform,
        address _sellToken,
        address _bAsset,
        address[] calldata _uniswapPath,
        uint256 _trancheAmount
    )
        external
        onlyGovernance
    {
        require(liquidations[_integration].sellToken == address(0), "Liquidation exists for this bAsset");
        require(
            _integration != address(0) &&
            _lendingPlatform != LendingPlatform.Null &&
            _sellToken != address(0),
            _bAsset != address(0),
            _uniswapPath.length >= uint(2),
            "Invalid inputs"
        );

        address pToken = IPlatformIntegration(_integration).bAssetToPToken(_bAsset);
        require(pToken != address(0), "no pToken for this bAsset");

        liquidations[_integration] = Liquidation({
            platform: _lendingPlatform,
            sellToken: _sellToken,
            bAsset: _bAsset,
            uniswapPath: _uniswapPath,
            lastTriggered: uint256(0),
            trancheAmount: _trancheAmount
        });

        _giveApproval(_integration, pToken);

        emit LiquidationModified(_integration);
    }

    function _giveApproval(address _integration, address _pToken) internal {

        // 1. Approve integration to collect pToken (bAsset or pToken change)
        // 2. Approve cToken to mint (bAsset or pToken change)

        Liquidation memory liquidation = liquidations[_integration];

        MassetHelpers.safeInfiniteApprove(_pToken, _integration);

        if (liquidation.platform == LendingPlatform.Compound) {
            MassetHelpers.safeInfiniteApprove(liquidation.bAsset, _pToken);
        }
    }

    function changeBasset(
        address _bAsset,
        address[] calldata _uniswapPath
    )
        external
        onlyGovernance
    {
        // todo
        // 1. Deal will old bAsset (if changed OR if pToken changed)
        //    > transfer remainer of pToken to integration
        //    > remove approval for both bAsset and pToken
        //    > make helper and share with delete
        // 2. Deal with new bAsset
        //    > Verify uniswap path
        //    > add approval for both bAsset and pToken
        //    > make helper and share with create
    }

    function changeTrancheAmount(
        uint256 _trancheAmount
    )
        external
        onlyGovernance
    {
        // todo
        // 1. Set the new tranche amount
    }

    /**
    * @dev Delete a liquidation
    */
    function deleteLiquidation(address _integration)
        external
        onlyGovernance
    {
        Liquidation memory liquidation = liquidations[_integration];
        require(liquidation.bAsset != address(0), "No liquidation for this integration");


        // todo
        // 1. Deal will old bAsset (if changed)
        //    > transfer remainer of pToken to integration
        //    > remove approval for both bAsset and pToken

        delete liquidations[_integration];
        emit LiquidationEnded(_integration);
    }

    /***************************************
                    LIQUIDATION
    ****************************************/


    function triggerLiquidation(address _integration)
        external
    {
        Liquidation memory liquidation = liquidations[_integration];
        address bAsset = liquidation.bAsset;
        require(bAsset != address(0), "Liquidation does not exist");
        require(block.timestamp > liquidation.lastTriggered.add(interval), "Must wait for interval");

        liquidation.lastTriggered = block.timestamp;

        // Cache variables
        address sellToken = liquidation.sellToken;
        address integration = liquidation.integration;

        // Transfer sellTokens from integration contract if there are some
        // Assumes infinite approval
        uint256 integrationBal = IERC20(sellToken).balanceOf(integration);
        if (integrationBal > 0) {
            IERC20(sellToken).safeTransferFrom(integration, address(this), integrationBal);
        }

        // Check contract balance
        uint256 bal = IERC20(sellToken).balanceOf(address(this));
        require((bal > 0), "No sell tokens to liquidate");

        // Get the amount to sell based on the tranche amount we want to buy
        (uint256 amountToSell, uint256 expectedAmount) = getAmountToSell(liquidation.uniswapPath, liquidation.trancheAmount);

        // The minimum amount of output tokens that must be received for the transaction not to revert
        // Set to 80% of expected
        uint256 minAcceptable = expectedAmount.mul(uint(8000)).div(uint(10000));

        // Sell amountToSell unless balance is lower in which case sell everything and relax acceptable check
        uint256 sellAmount;
        if (bal > amountToSell) {
            sellAmount = amountToSell;
        } else {
            sellAmount = bal;
            minAcceptable = 0;
        }

        // Approve Uniswap and make the swap
        // https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens
        IERC20(sellToken).safeApprove(uniswapAddress, 0);
        IERC20(sellToken).safeApprove(uniswapAddress, amountToSell);
        IUniswapV2Router02(uniswapAddress).swapExactTokensForTokens(
            sellAmount,
            minAcceptable,
            liquidation.uniswapPath,
            address(this),
            block.timestamp.add(1800)
        );

        // Deposit to lending platform
        // Assumes integration contracts have inifinte approval to collect them
        if (liquidation.lendingPlatform == LendingPlatform.Compound) {
            depositToCompound(liquidation.pToken, _bAsset);
        } else {
            revert("Lending Platform not supported");
        }

        emit LiquidationTriggered(_bAsset);
    }

    /**
    * @dev Deposits to Compound
    * @param _pToken The _pToken to mint
    * @param _bAsset The _bAsset liquidation to be triggered
    */
    function depositToCompound(address _pToken, address _bAsset)
        internal
    {
        uint256 bAssetBalance = IERC20(_bAsset).balanceOf(address(this));
        require((bAssetBalance > 0), "No tokens to deposit");
        require(ICERC20(_pToken).mint(bAssetBalance) == 0, "cToken mint failed");
    }

    /**
    * @dev Get the amount of sellToken to be sold for a number of bAsset
    * @param _uniswapPath The Uniswap path for this liquidation
    * @param _trancheAmount The tranche size that we want to buy each time
    */
    function getAmountToSell(
        address[]   memory _uniswapPath,
        uint256      _trancheAmount
    )
        internal view returns (uint256, uint256)
    {

        // The _trancheAmount is the number of bAsset we want to buy each time
        // DAI has 18 decimals so 1000 DAI is 10*10^18 or 1000000000000000000000
        // This value is set when adding the liquidation
        // We randomize this amount by buying betwen 80% and 95% of the amount.
        // Uniswap gives us the amount we need to sell with `getAmountsIn`.
        uint256 randomBasisPoint = uint256(blockhash(block.number-1)).mod(uint(1500)).add(uint(8000));
        uint256 amountWanted = _trancheAmount.mul(randomBasisPoint).div(uint(10000));

        // Returns the minimum input asset amount required to buy
        // the given output asset amount (accounting for fees) given reserves
        // https://uniswap.org/docs/v2/smart-contracts/router02/#getamountsin
        uint[] memory amountsIn = IUniswapV2Router02(uniswapAddress).getAmountsIn(amountWanted, _uniswapPath);

        return (amountsIn[0], amountWanted);
    }


    /***************************************
                    CLAIM
    ****************************************/

}
