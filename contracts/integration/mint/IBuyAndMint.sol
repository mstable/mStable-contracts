pragma solidity 0.5.16;

interface IBuyAndMint {
    /**
     */
    function buyAndMint(address _srcBasset, address _destMasset)
        external payable returns (uint256 qtyMinted);

    /**
     */
    function buyAndMint(address _srcBasset, address _destMasset, uint256 _amountOfMasset)
        external payable returns (uint256 qtyMinted);

    /**
     */
    function buyAndMint(
        address[] calldata _srcBassets,
        uint256[] calldata _ethAmount,
        address _destMAsset
    ) external payable returns (uint256 qtyMinted);
}