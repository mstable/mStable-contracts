pragma solidity 0.5.16;

// External
import { AbstractBuyAndMint } from "./AbstractBuyAndMint.sol";

contract MintWith1Inch is AbstractBuyAndMint {

    address public addr1Inch;

    constructor(address _1inch, address[] memory _mAssets)
        public
        AbstractBuyAndMint(_mAssets)
    {
        require(_1inch != address(0), "1inch address is zero");

        addr1Inch = _1inch;
    }

    function buyAndMint(
        address _srcBasset,
        address _destMasset
    )
        external
        payable
        returns (uint256 qtyMinted)
    {
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