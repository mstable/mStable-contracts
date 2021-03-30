// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

import { IBoostDirector } from "../../interfaces/IBoostDirector.sol";

contract MockBoostedSavingsVault {

    IBoostDirector public immutable boostDirector;

    event Poked(address indexed user);
    event TestGetBalance(uint256 balance);

    constructor(address _boostDirector) {
        boostDirector = IBoostDirector(_boostDirector);
    }

    function pokeBoost(address _account) external {
        emit Poked(_account);
    }

    function testGetBalance(address _user) external returns (uint256 balance) {
        balance = boostDirector.getBalance(_user);

        emit TestGetBalance(balance);
    }
}