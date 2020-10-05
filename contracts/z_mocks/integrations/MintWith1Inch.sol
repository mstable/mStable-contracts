pragma solidity 0.5.16;

// External
import { AbstractBuyAndMint } from "./AbstractBuyAndMint.sol";
import { IMasset } from "../../interfaces/IMasset.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @dev OneSplit Exchange interface
 */
contract IOneSplit {
    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 amount,
        uint256 minReturn,
        uint256[] memory distribution,
        uint256 flags
    ) public payable;
}

/**
 * @title   MintWith1Inch
 * @author  Stability Labs Pty. Ltd.
 * @notice  Contract integrates with 1inch (a.k.a OneSplit) contract and allows anyone to buy
 *          bAsset tokens using ETH from the 1inch and mint mAssets.
 */
contract MintWith1Inch is AbstractBuyAndMint {

    using SafeMath for uint256;

    // 1inch Exchange 1Split contract address
    IOneSplit public oneSplit;

    IERC20 private constant ETH_ADDRESS = IERC20(0x0000000000000000000000000000000000000000);

    /**
     * @param _oneSplit OneSplit contract address
     * @param _mAssets Array of mAssets addresses
     */
    constructor(address _oneSplit, address[] memory _mAssets)
        public
        AbstractBuyAndMint(_mAssets)
    {
        require(_oneSplit != address(0), "1inch address is zero");

        oneSplit = IOneSplit(_oneSplit);
    }

    // @override
    function _externalDexAddress() internal view returns(address) {
        return address(oneSplit);
    }

    // NOTICE: Make the following function call off-chain to get the `distribution` and
    // pass to this function. This is to reduce gas consumption.

    // ============================================================================
    // Offchain: To calculate the distribution to mint max mAssets with ETH amount
    // ============================================================================
    /*
    // Parts = 20 (Suggested by 1inch to provide best rates)
    uint256 parts = 20;
    // Not disable any exchange
    uint256 disableFlags = 0;
    (,uint256[] memory distribution) =
        oneSplit.getExpectedReturn(
            ETH_ADDRESS,        //fromToken
            IERC20(_srcBasset), //toToken
            msg.value,          //fromAmount
            parts,              //parts
            disableFlags        //disableFlags
        );
    */

    // @override
    function buyAndMint(
        IERC20 _srcBasset,
        address _destMasset,
        uint256 _minBassetUnits,
        uint256[] calldata _distribution
    )
        external
        payable
        returns (uint256 mAssetQtyMinted)
    {
        require(msg.value > 0, "ETH not sent");
        require(_massetExists(_destMasset), "Not a valid mAsset");

        // 1. Buy bAsset of worth `msg.value` ETH from OneSplit
        oneSplit.swap.value(msg.value)(
            ETH_ADDRESS,
            _srcBasset,
            msg.value,
            _minBassetUnits,
            _distribution,
            0
        );

        uint256 balance = _srcBasset.balanceOf(address(this));
        // 2. Mint mAsset with all bAsset
        mAssetQtyMinted = IMasset(_destMasset).mintTo(address(_srcBasset), balance, _msgSender());
    }
}