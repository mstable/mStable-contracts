pragma solidity 0.5.16;

interface ICERC20 {
    function mint(uint mintAmount) external returns (uint);

    function redeemUnderlying(uint redeemAmount) external returns (uint);

    function balanceOfUnderlying(address owner) external returns (uint);
}
