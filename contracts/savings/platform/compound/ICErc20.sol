pragma solidity ^0.5.16;

interface ICErc20 {
    function mint(uint mintAmount) external returns (uint);

    function redeem(uint redeemTokens) external returns (uint);

    function balanceOfUnderlying(address owner) external returns (uint);
}