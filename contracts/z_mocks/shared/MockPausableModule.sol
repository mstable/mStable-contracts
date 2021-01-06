// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.7.6;

import { PausableModule } from "../../shared/PausableModule.sol";

contract MockPausableModule is PausableModule {

    constructor(address _nexus) public PausableModule(_nexus) {}
}