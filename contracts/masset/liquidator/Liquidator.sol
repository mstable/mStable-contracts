pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// TODO - remove
import "@nomiclabs/buidler/console.sol";

import { IUniswapV2Router02 } from "./IUniswapV2Router02.sol";
import { ICERC20 } from "../platform-integrations/ICompound.sol";
import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableModule } from "../../shared/InitializableModule.sol";
import { ILiquidator } from "./ILiquidator.sol";
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
    ILiquidator,
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

    struct Liquidation {
        LendingPlatform platform;

        address sellToken;

        address bAsset;
        address pToken;
        address[] uniswapPath;

        uint256 collectUnits;  // Minimum collection amount for the integration, updated after liquidation
        uint256 lastTriggered;
        uint256 sellTranche;   // Tranche amount, with token decimals
    }

    function initialize(
        address _nexus,
        address _uniswapAddress
    )
        external
        initializer
    {
        InitializableModule._initialize(_nexus);

        require(_uniswapAddress != address(0), "Invalid uniswap address");
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
    * @param _sellTranche The amount of tokens to be sold when triggered (in token decimals)
    */
    function createLiquidation(
        address _integration,
        LendingPlatform _lendingPlatform,
        address _sellToken,
        address _bAsset,
        address[] calldata _uniswapPath,
        uint256 _sellTranche
    )
        external
        onlyGovernance
    {
        require(liquidations[_integration].sellToken == address(0), "Liquidation exists for this bAsset");
        require(
            _integration != address(0) &&
            _lendingPlatform != LendingPlatform.Null &&
            _sellToken != address(0) &&
            _bAsset != address(0) &&
            _uniswapPath.length >= uint(2),
            "Invalid inputs"
        );
        require(_validUniswapPath(_sellToken, _bAsset, _uniswapPath), "Invalid uniswap path");

        address pToken = IPlatformIntegration(_integration).bAssetToPToken(_bAsset);
        require(pToken != address(0), "no pToken for this bAsset");

        liquidations[_integration] = Liquidation({
            platform: _lendingPlatform,
            sellToken: _sellToken,
            bAsset: _bAsset,
            pToken: pToken,
            uniswapPath: _uniswapPath,
            collectUnits: 0,
            lastTriggered: 0,
            sellTranche: _sellTranche
        });

        emit LiquidationModified(_integration);
    }

    function updateBasset(
        address _integration,
        address _bAsset,
        address[] calldata _uniswapPath
    )
        external
        onlyGovernance
    {
        Liquidation memory liquidation = liquidations[_integration];

        address oldBasset = liquidation.bAsset;
        require(oldBasset != address(0), "Liquidation does not exist");
        require(_bAsset != address(0), "Invalid bAsset");

        require(_validUniswapPath(liquidation.sellToken, _bAsset, _uniswapPath), "Invalid uniswap path");

        // 1. Deal will old bAsset (if changed OR if pToken changed)
        address newPToken = IPlatformIntegration(_integration).bAssetToPToken(_bAsset);
        require(newPToken != address(0), "no pToken for this bAsset");

        address oldPToken = liquidation.pToken;
        bool pTokenChanged = newPToken != oldPToken;
        if(pTokenChanged){
            // > transfer remainer of pToken to integration
            uint256 oldPTokenBal = IERC20(oldPToken).balanceOf(address(this));
            if(oldPTokenBal != 0) {
                IERC20(oldPToken).safeTransfer(_integration, oldPTokenBal);
            }
        }

        liquidations[_integration].bAsset = _bAsset;
        liquidations[_integration].pToken = newPToken;
        liquidations[_integration].uniswapPath = _uniswapPath;

        emit LiquidationModified(_integration);
    }

    function _validUniswapPath(address _sellToken, address _bAsset, address[] memory _uniswapPath)
        internal
        pure
        returns (bool)
    {
        uint256 len = _uniswapPath.length;
        return _sellToken == _uniswapPath[0] && _bAsset == _uniswapPath[len-1];
    }

    function changeTrancheAmount(
        address _integration,
        uint256 _sellTranche
    )
        external
        onlyGovernance
    {
        Liquidation memory liquidation = liquidations[_integration];
        require(liquidation.bAsset != address(0), "Liquidation does not exist");

        liquidations[_integration].sellTranche = _sellTranche;

        emit LiquidationModified(_integration);
    }

    /**
    * @dev Delete a liquidation
    */
    function deleteLiquidation(address _integration)
        external
        onlyGovernance
    {
        Liquidation memory liquidation = liquidations[_integration];
        require(liquidation.bAsset != address(0), "Liquidation does not exist");

        address oldPToken = liquidation.pToken;
        uint256 oldPTokenBal = IERC20(oldPToken).balanceOf(address(this));
        if(oldPTokenBal != 0) {
            IERC20(oldPToken).safeTransfer(_integration, oldPTokenBal);
        }

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
        liquidations[_integration].lastTriggered = block.timestamp;

        // Cache variables
        address sellToken = liquidation.sellToken;
        address[] memory uniswapPath = liquidation.uniswapPath;

        // 1. Transfer sellTokens from integration contract if there are some
        //    Assumes infinite approval
        uint256 integrationBal = IERC20(sellToken).balanceOf(_integration);
        console.log("tl: IntegrationBal %s", integrationBal);
        if (integrationBal > 0) {
            IERC20(sellToken).safeTransferFrom(_integration, address(this), integrationBal);
        }

        // 2. Get the amount to sell based on the tranche amount we want to buy
        //    Check contract balance
        uint256 sellTokenBal = IERC20(sellToken).balanceOf(address(this));
        require(sellTokenBal > 0, "No sell tokens to liquidate");
        require(liquidation.sellTranche > 0, "Liquidation has been paused");
        //    Calc amounts for max tranche
        console.log("tl: Getting amounts in %s", liquidation.sellTranche);
        uint[] memory amountsIn = IUniswapV2Router02(uniswapAddress).getAmountsIn(liquidation.sellTranche, uniswapPath);
        uint256 sellAmount = amountsIn[0];
        console.log("tl: SellAmount in %s", sellAmount);

        if (sellTokenBal < sellAmount) {
            sellAmount = sellTokenBal;
        }

        // 3. Make the swap
        // 3.1 Approve Uniswap and make the swap
        IERC20(sellToken).safeApprove(uniswapAddress, 0);
        IERC20(sellToken).safeApprove(uniswapAddress, sellAmount);

        // 3.2. Make the sale > https://uniswap.org/docs/v2/smart-contracts/router02/#swapexacttokensfortokens
        console.log("tl: Swapping %s, balance: %s", sellAmount, IERC20(sellToken).balanceOf(address(this)));
        IUniswapV2Router02(uniswapAddress).swapExactTokensForTokens(
            sellAmount,
            0,
            uniswapPath,
            address(this),
            block.timestamp.add(1800)
        );
        uint256 bAssetBal = IERC20(bAsset).balanceOf(address(this));

        // 4. Deposit to lending platform
        //    Assumes integration contracts have inifinte approval to collect them
        if (liquidation.platform == LendingPlatform.Compound) {
            // 4.1. Exec deposit
            console.log("tl: Depositing: %s", bAssetBal);
            ICERC20 cToken = ICERC20(liquidation.pToken);
            IERC20(bAsset).safeApprove(address(cToken), 0);
            IERC20(bAsset).safeApprove(address(cToken), bAssetBal);
            require(cToken.mint(bAssetBal) == 0, "cToken mint failed");

            // 4.2. Set minCollect to 25% of received
            uint256 cTokenBal = cToken.balanceOf(address(this));
            liquidations[_integration].collectUnits = cTokenBal.mul(25).div(100);
        } else {
            revert("Lending Platform not supported");
        }

        emit Liquidated(sellToken, bAsset, bAssetBal);
    }


    /***************************************
                    COLLECT
    ****************************************/

    function collect()
        external
    {
        Liquidation memory liquidation = liquidations[msg.sender];
        address pToken = liquidation.pToken;
        if(pToken != address(0)){
            uint256 bal = IERC20(pToken).balanceOf(address(this));
            if (bal > 0) {
                // If we are below the threshold transfer the entire balance
                // otherwise send between 5 and 35%
                if (bal > liquidation.collectUnits) {
                    bytes32 bHash = blockhash(block.number - 1);
                    uint256 randomBp = uint256(keccak256(abi.encodePacked(block.timestamp, bHash))).mod(3e17).add(5e16);
                    bal = bal.mul(randomBp).div(1e18);
                }
                IERC20(pToken).safeTransfer(msg.sender, bal);
            }
        }
    }
}