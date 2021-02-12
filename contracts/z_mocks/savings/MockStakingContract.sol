// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

contract MockStakingContract {

    mapping (address => uint256) private _balances;

    function setBalanceOf(address account, uint256 balance) public {
      _balances[account] = balance;
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }
}