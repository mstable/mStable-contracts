// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IBoostDirector } from "../../interfaces/IBoostDirector.sol";

contract MockBoostedVault {
    IBoostDirector public immutable boostDirector;

    event Poked(address indexed user);
    event TestGetBalance(uint256 balance);

    constructor(address _boostDirector) {
        boostDirector = IBoostDirector(_boostDirector);
    }

    function pokeBoost(address _user) external {
        emit Poked(_user);
    }

    function testGetBalance(address _user) external returns (uint256 balance) {
        balance = boostDirector.getBalance(_user);

        emit TestGetBalance(balance);
    }
}
