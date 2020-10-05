pragma solidity 0.5.16;

// External
import { AbstractBuyAndMint } from "./AbstractBuyAndMint.sol";

// Internal
import { IMasset } from "../../interfaces/IMasset.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { StableMath } from "../../shared/StableMath.sol";

/**
 * @title   MintWithKyber
 * @author  Stability Labs Pty. Ltd.
 * @notice  Contract integrates with Kyber Network Proxy contract and allows anyone to buy
 *          bAsset tokens using ETH from the Kyber platform and mint mAsset tokens from mStable.
 */
contract MintWithKyber is AbstractBuyAndMint, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using Address for address payable;
    using StableMath for uint256;

    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    // TODO update FEE_COLLECTION_ADDRESS address once registered for Kyber Fee Sharing program
    // https://developer.kyber.network/docs/Integrations-FeeSharing/
    // TODO UPDATE THIS ADDRESS
    address constant public FEE_COLLECTION_ADDRESS = address(0);

    KyberNetworkProxyInterface public kyberNetworkProxy;

    /**
     * @dev Constructor
     * @param _kyberNetworkProxy Kyeber Network Proxy contract address
     * @param _mAssets Array of mAssets addresses
     */
    constructor(address _kyberNetworkProxy, address[] memory _mAssets)
        public
        AbstractBuyAndMint(_mAssets)
    {
        require(_kyberNetworkProxy != address(0), "Kyber proxy address is zero");

        kyberNetworkProxy = KyberNetworkProxyInterface(_kyberNetworkProxy);
    }

    // @override
    function _externalDexAddress() internal view returns(address) {
        return address(kyberNetworkProxy);
    }

    // @override
    function buyAndMintMaxMasset(
        address _srcBasset,
        address _destMasset
    )
        external
        payable
        nonReentrant
        returns (uint256 mAssetQtyMinted)
    {
        require(msg.value > 0, "ETH not sent");
        require(_massetExists(_destMasset), "Not a valid mAsset");

        mAssetQtyMinted = _buyAndMint(_srcBasset, _destMasset, msg.value, _msgSender());
    }

    // @override
    function buyAndMintGivenMasset(
        address _srcBasset,
        address _destMasset,
        uint256 _amountOfBasset
    )
        external
        payable
        nonReentrant
        returns (uint256 mAssetQtyMinted)
    {
        require(_massetExists(_destMasset), "Not a valid mAsset");

        // Get the rate from Kyber for `_amountOfBasset`
        // Example rate to convert from DAI => ETH
        (uint256 expectedRate,) = kyberNetworkProxy.getExpectedRate(_srcBasset, ETH_TOKEN_ADDRESS, _amountOfBasset);

        // amountOfBassets * expectedRate / 1e18
        uint256 amountInETH = _amountOfBasset.mulTruncate(expectedRate);
        require(msg.value >= amountInETH, "Not enough ETH sent");

        // Pass the `expectedRate` ETH to Kyber
        mAssetQtyMinted = _buyAndMint(_srcBasset, _destMasset, amountInETH, _msgSender());

        // Return remaining ETH balance to the user
        // WARNING: Reentrancy Guard used for external functions
        msg.sender.sendValue(msg.value.sub(amountInETH));
    }

    // @override
    function buyAndMintMulti(
        address[] calldata _srcBassets,
        uint256[] calldata _ethAmount,
        address _destMasset
    )
        external
        payable
        nonReentrant
        returns (uint256 mAssetQtyMinted)
    {
        require(msg.value > 0, "ETH not sent");
        uint256 bAssetsLen = _srcBassets.length;
        require(bAssetsLen > 0, "No array data sent");
        require(bAssetsLen == _ethAmount.length, "Array length not matched");
        require(_massetExists(_destMasset), "Not a valid mAsset");
        // NOTICE: Assuming DApp validated that the `sum(_ethAmount[]) == msg.value`,
        // otherwise tx will fail

        mAssetQtyMinted = _buyAndMintMulti(_srcBassets, _ethAmount, _destMasset, _msgSender());
    }

    /**
     * @dev Buy bAssets with ETH and Mint mAsset from mStable. Send mAssets to the user.
     * @param _srcBasset Source bAsset to buy from Kyber
     * @param _destMasset mAsset to mint from mStable
     * @param _ethAmount Amount of ETH to user to buy bAssets
     * @param _recipient Recipient of the mStable tokens
     * @return mAssetQtyMinted Returns the total quantity of mAssets minted
     */
    function _buyAndMint(
        address _srcBasset,
        address _destMasset,
        uint256 _ethAmount,
        address _recipient
    )
        internal
        returns (uint256 mAssetQtyMinted)
    {
        // 1. Buy bAsset of worth `_ethAmount` ETH from Kyber
        uint256 bAssetQtyMinted = _buyBassetsFromKyberWithETH(_srcBasset, _ethAmount);

        // 2. Mint mAsset with all bAsset
        mAssetQtyMinted = IMasset(_destMasset).mintTo(address(_srcBasset), bAssetQtyMinted, _recipient);
    }

    /**
     * @dev Buy multiple bAssets using corrosponding ETH amount from Kyber and mint mAssets
     *      using these bAssets.
     * @param _srcBassets Array of bAssets to buy from Kyber
     * @param _ethAmounts Array of eth amount to use corrosponding bAssets
     * @param _destMasset mAsset address to mint
     * @param _recipient Recipient of the mStable tokens
     * @return mAssetQtyMinted Returns the total quantity of mAssets minted
     */
    function _buyAndMintMulti(
        address[] memory _srcBassets,
        uint256[] memory _ethAmounts,
        address _destMasset,
        address _recipient
    )
        internal
        returns (uint256 mAssetQtyMinted)
    {
        uint256[] memory bAssetsQtyMinted = new uint256[](_srcBassets.length);

        for(uint256 i = 0; i < _srcBassets.length; i++) {
            bAssetsQtyMinted[i] = _buyBassetsFromKyberWithETH(_srcBassets[i], _ethAmounts[i]);
        }

        mAssetQtyMinted = IMasset(_destMasset).mintMulti(_srcBassets, bAssetsQtyMinted, _recipient);
    }

    /**
     * @dev Buy bAsset tokens worth of ETH amount sent from Kyber
     * @param _srcBasset Source bAsset to buy from Kyber
     * @param _ethAmount Amount of ETH to user to buy bAssets
     * @return bAssetsQtyMinted Returns the total quantity of bAssets minted from Kyber
     */
    function _buyBassetsFromKyberWithETH(
        address _srcBasset,
        uint256 _ethAmount
    )
        internal
        returns (uint256 bAssetsQtyMinted)
    {
        bAssetsQtyMinted =
            kyberNetworkProxy.tradeWithHint.value(_ethAmount)(
                ETH_TOKEN_ADDRESS,
                _ethAmount,
                _srcBasset,
                address(this),
                1 << 255,
                0,
                FEE_COLLECTION_ADDRESS,
                ""
            );
        require(bAssetsQtyMinted > 0, "No bAsset minted");
        require(IERC20(_srcBasset).balanceOf(address(this)) >= bAssetsQtyMinted, "bAsset token not received");
    }
}

/**
 * @dev Kyber Network Proxy to integrate with Kyber Network contracts
 */
interface KyberNetworkProxyInterface {
    // NOTICE: Commented out unused functions
    //function maxGasPrice() public view returns(uint);
    //function getUserCapInWei(address user) public view returns(uint);
    //function getUserCapInTokenWei(address user, ERC20 token) public view returns(uint);
    //function info(bytes32 id) public view returns(uint);

    //function enabled() external view returns(bool);

    function getExpectedRate(
        address src,
        address dest,
        uint srcQty) external view returns (uint expectedRate, uint slippageRate);

    function tradeWithHint(
        address src,
        uint srcAmount,
        address dest,
        address destAddress,
        uint maxDestAmount,
        uint minConversionRate,
        address walletId,
        bytes calldata hint) external payable returns(uint);
}
