pragma solidity 0.5.16;

// External
import { AbstractBuyAndMint } from "./AbstractBuyAndMint.sol";

// Internal
import { IMasset } from "../../interfaces/IMasset.sol";

// Libs
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


/**
 * @dev KyberNetwork's SimpleNetworkInterface
 */
interface SimpleNetworkInterface {
    function swapEtherToToken(address token, uint256 minConversionRate) external payable returns(uint);
}

/**
 * @title   MintWithKyber
 * @author  Stability Labs Pty. Ltd.
 * @notice  Contract integrates with Kyber Network Proxy contract and allows anyone to buy
 *          bAsset tokens using ETH from the Kyber platform and mint mAsset tokens from mStable.
 */
contract MintWithKyber is AbstractBuyAndMint {
    using SafeERC20 for IERC20;

    address constant internal ETH_TOKEN_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    SimpleNetworkInterface public kyberNetworkProxy;

    constructor(address _kyberNetworkProxy, address[] memory _mAssets)
        public
        AbstractBuyAndMint(_mAssets)
    {
        require(_kyberNetworkProxy != address(0), "Kyber proxy address is zero");

        kyberNetworkProxy = SimpleNetworkInterface(_kyberNetworkProxy);
    }

    function _exteranlDexAddress() internal returns(address) {
        return address(kyberNetworkProxy);
    }

    function buyAndMint(
        address _srcBasset,
        address _destMasset
    )
        external
        payable
        returns (uint256 qtyMinted)
    {
        require(msg.value > 0, "ETH not sent");
        // TODO is valid bAsset and mAsset

        // 1. Buy bAsset of worth `msg.value` ETH from Kyber
        uint256 bAssetQtyMinted = kyberNetworkProxy.swapEtherToToken.value(msg.value)(_srcBasset, 0);
        require(bAssetQtyMinted > 0, "No bAsset minted");
        require(IERC20(_srcBasset).balanceOf(address(this)) >= bAssetQtyMinted, "bAsset token not received");

        // 2. Mint mAsset with all bAsset
        uint256 mAssetQtyMinted = IMasset(_destMasset).mint(address(_srcBasset), bAssetQtyMinted);
        require(mAssetQtyMinted > 0, "No mAsset minted");
        require(IERC20(_destMasset).balanceOf(address(this)) >= mAssetQtyMinted, "mAsset token not received");

        // 3. Transfer minted quantity of mAsset to msg.sender
        IERC20(_destMasset).safeTransfer(msg.sender, mAssetQtyMinted);

        qtyMinted = mAssetQtyMinted;
    }

    function buyAndMint(
        address _srcBasset,
        address _destMasset,
        uint256 _amountOfMasset
    )
        external
        payable
        returns (uint256 qtyMinted)
    {

    }

    function buyAndMint(
        address[] calldata _srcBassets,
        uint256[] calldata _ethAmount,
        address _destMAsset
    )
        external
        payable
        returns (uint256 qtyMinted)
    {

    }
}