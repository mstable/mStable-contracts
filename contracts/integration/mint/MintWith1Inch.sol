pragma solidity 0.5.16;

// External
import { AbstractBuyAndMint } from "./AbstractBuyAndMint.sol";

// Internal
import { IMasset } from "../../interfaces/IMasset.sol";

// Libs
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title   MintWith1Inch
 * @author  Stability Labs Pty. Ltd.
 * @notice  Contract integrates with 1inch (OneSplit) contract and allows anyone to buy
 *          bAsset tokens using ETH from the 1inch and mint mAsset tokens from mStable.
 */
contract MintWith1Inch is AbstractBuyAndMint {
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
        address _destMasset
    )
        external
        payable
        returns (uint256 mAssetQtyMinted)
    {
        require(msg.value > 0, "ETH not sent");
        require(_isMassetExist(_destMasset), "Not a valid mAsset");

        // Parts = 1 (to avoid loop, so that 100% bAssets will be bought from single DEX)
        uint256 parts = 1;
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

        mAssetQtyMinted = _buyAndMint(_srcBasset, _destMasset, msg.value, distribution, _msgSender());
    }

    // @override
    function buyAndMint(
        address _srcBasset,
        address _destMasset,
        uint256 _amountOfMasset
    )
        external
        payable
        returns (uint256 mAssetQtyMinted)
    {
        require(_isMassetExist(_destMasset), "Not a valid mAsset");

        // Get the rate from OneSplit for `_amountOfMasset` of mAsset into ETH
        // Parts = 1 (to avoid loop, so that 100% bAssets will be bought from single DEX)
        uint256 parts = 1;
        // Not disable any exchange
        uint256 disableFlags = 0;

        // Get amount in ETH to buy _amountOfMasset
        (uint256 ethAmount, uint256[] memory distribution) =
            oneSplit.getExpectedReturn(
                IERC20(_destMasset),    //fromToken
                ETH_ADDRESS,            //toToken
                _amountOfMasset,        //fromAmount
                parts,                  //parts
                disableFlags            //disableFlags
            );

        mAssetQtyMinted = _buyAndMint(_srcBasset, _destMasset, ethAmount, distribution, _msgSender());
    }

    // @override
    function buyAndMint(
        address[] calldata /*_srcBassets*/,
        uint256[] calldata /*_ethAmount*/,
        address /*_destMAsset*/
    )
        external
        payable
        returns (uint256 /*mAssetQtyMinted*/)
    {
        revert("buyAndMint for mintMulti not implemented");
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
        require(mAssetQtyMinted > 0, "No mAsset minted");
        require(IERC20(_destMasset).balanceOf(address(this)) >= mAssetQtyMinted, "mAsset token not received");
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

    function swap(
        IERC20 fromToken,
        IERC20 toToken,
        uint256 amount,
        uint256 minReturn,
        uint256[] memory distribution,
        uint256 disableFlags
    ) public payable;
}