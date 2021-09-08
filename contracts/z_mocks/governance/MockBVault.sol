// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../governance/staking/interfaces/IBVault.sol";
import "./MockBPT.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Creating mock token:
//  - create MockBPT and mint some supply
//  - call addPool with the tokens and the raito
//    - addPool sets the ratios, and transfers required underlying from the sender

contract MockBVault is IBVault {
    mapping(bytes32 => MockBPT) public pools;
    mapping(address => bytes32) public poolIds;
    mapping(address => IERC20[]) public tokenData;

    function addPool(
        address _addr,
        IERC20[] memory _tokens,
        uint256[] memory _unitsPerBpt
    ) external {
        pools[blockhash(block.number - 1)] = MockBPT(_addr);
        poolIds[_addr] = blockhash(block.number - 1);
        uint256 supply = IERC20(_addr).totalSupply();
        require(supply > 1000e18, "Must have tokens");
        require(_unitsPerBpt.length == 2, "Invalid ratio");
        tokenData[_addr] = _tokens;
        _tokens[0].transferFrom(msg.sender, address(this), (_unitsPerBpt[0] * supply) / 1e18);
        _tokens[1].transferFrom(msg.sender, address(this), (_unitsPerBpt[1] * supply) / 1e18);
    }

    function exitPool(
        bytes32 poolId,
        address sender,
        address payable recipient,
        ExitPoolRequest memory request
    ) external override {
        MockBPT pool = pools[poolId];
        require(address(pool) != address(0), "Invalid addr");

        address output = request.assets[0];
        uint256 minOut = request.minAmountsOut[0];
        (, uint256 bptIn, ) = abi.decode(request.userData, (uint256, uint256, uint256));
        // Burn the tokens
        pool.onExitPool(sender, bptIn);

        uint256 bptSupply = pool.totalSupply();
        uint256 outputBal = IERC20(output).balanceOf(address(this));

        // Pay out the underlying
        uint256 returnUnits = (((outputBal * bptIn) / bptSupply) * 120) / 100;
        require(returnUnits > minOut, "Min out not met");
        IERC20(output).transfer(recipient, returnUnits);
    }

    function getPoolTokens(bytes32 poolId)
        external
        view
        override
        returns (
            address[] memory tokens,
            uint256[] memory balances,
            uint256 /*lastChangeBlock*/
        )
    {
        MockBPT pool = pools[poolId];
        IERC20[] memory tokenDatas = tokenData[address(pool)];
        uint256 len = tokenDatas.length;
        tokens = new address[](len);
        balances = new uint256[](len);
        for (uint256 i = 0; i < len; i++) {
            tokens[i] = address(tokenDatas[i]);
            balances[i] = tokenDatas[i].balanceOf(address(this));
        }
    }
}
