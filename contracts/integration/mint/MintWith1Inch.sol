pragma solidity 0.5.16;

// External
import { AbstractBuyAndMint } from "./AbstractBuyAndMint.sol";
import { IBuyAndMintWithOneSplit } from "./IBuyAndMintWithOneSplit.sol";

// Internal
import { IMasset } from "../../interfaces/IMasset.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title   MintWith1Inch
 * @author  Stability Labs Pty. Ltd.
 * @notice  Contract integrates with 1inch (OneSplit) contract and allows anyone to buy
 *          bAsset tokens using ETH from the 1inch and mint mAsset tokens from mStable.
 */
contract MintWith1Inch is AbstractBuyAndMint, IBuyAndMintWithOneSplit {
    using SafeMath for uint256;

    // 1inch Exchange 1Split contract address
    IOneSplit public oneSplit;

    IERC20 private constant ETH_ADDRESS = IERC20(address(0));

    /**
     * @dev Constructor
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
    function _exteranlDexAddress() internal returns(address) {
        return address(oneSplit);
    }

    // @override
    function buyAndMint(
        address _srcBasset,
        address _destMasset,
        uint256[] calldata _distribution
    )
        external
        payable
        returns (uint256 mAssetQtyMinted)
    {
        require(msg.value > 0, "ETH not sent");
        require(_isMassetExist(_destMasset), "Not a valid mAsset");

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

        // =======================================================================
        // Offchain: To calculate the distribution using expected mAssets to mint
        // =======================================================================
        // Get amount in ETH to buy _amountOfMasset
        /*
        (uint256 ethAmount, uint256[] memory distribution) =
            oneSplit.getExpectedReturn(
                IERC20(_srcBasset),    //fromToken
                ETH_ADDRESS,            //toToken
                _amountOfMasset,        //fromAmount
                parts,                  //parts
                disableFlags            //disableFlags
            );
        */

        mAssetQtyMinted = _buyAndMint(_srcBasset, _destMasset, msg.value, _distribution, _msgSender());
    }

    /**
     * @dev Buy bAssets with ETH and Mint mAsset from mStable. Send mAssets to the user.
     * @param _srcBasset Source bAsset to buy from OneSplit
     * @param _destMasset mAsset to mint from mStable
     * @param _ethAmount Amount of ETH to user to buy bAssets
     * @param _distribution Exchange distribution
     * @param _recipient Recipient of the mStable tokens
     * @return mAssetQtyMinted Returns the total quantity of mAssets minted
     */
    function _buyAndMint(
        address _srcBasset,
        address _destMasset,
        uint256 _ethAmount,
        uint256[] memory _distribution,
        address _recipient
    )
        internal
        returns (uint256 mAssetQtyMinted)
    {
        // 1. Buy bAsset of worth `_ethAmount` ETH from OneSplit
        uint256 bAssetQtyMinted =
            _buyBassetFromOneSplitWithETH(
                IERC20(_srcBasset),
                _ethAmount,
                _distribution
            );

        // 2. Mint mAsset with all bAsset
        mAssetQtyMinted = IMasset(_destMasset).mintTo(address(_srcBasset), bAssetQtyMinted, _recipient);
    }

    /**
     * @dev Buy bAssets from OneSplit exchange with ETH
     * @param _toBasset bAsset address to buy from exchange
     * @param _ethAmount ETH amount to buy bAssets
     * @param _distribution Exchange distribution details
     * @return bAssetQtyMinted bAssets quantity minted from OneSplit exchange
     */
    function _buyBassetFromOneSplitWithETH(
        IERC20 _toBasset,
        uint256 _ethAmount,
        uint256[] memory _distribution
    )
        internal
        returns (uint256 bAssetQtyMinted)
    {
        uint256 bAssetBalBefore = _toBasset.balanceOf(address(this));

        // Quantity of bAsset minted is not returned from OneSplit
        oneSplit.swap.value(_ethAmount)(
            ETH_ADDRESS,    //fromToken
            _toBasset,      //toToken
            _ethAmount,     //fromAmount
            0,              //minReturn
            _distribution,  //distribution
            0               //disableFlags
        );

        uint256 bAssetBalAfter = _toBasset.balanceOf(address(this));
        bAssetQtyMinted = bAssetBalAfter.sub(bAssetBalBefore);
        require(bAssetQtyMinted > 0, "No bAsset minted");
    }
}

/**
 * @dev OneSplit Exchange interface
 */
contract IOneSplit {
    // Below function only called offchain, to reduce gas consumtion
    /*
    function getExpectedReturn(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 amount,
        uint256 parts,
        uint256 disableFlags
    )
        public
        view
        returns(
            uint256 returnAmount,
            uint256[] memory distribution
        );
    */

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 amount,
        uint256 minReturn,
        uint256[] memory distribution,
        uint256 disableFlags
    ) public payable;
}