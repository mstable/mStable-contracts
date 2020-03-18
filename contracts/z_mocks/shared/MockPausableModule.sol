pragma solidity 0.5.16;

import { PausableModule } from "../../shared/PausableModule.sol";

contract MockPausableModule is PausableModule {

    constructor(address _nexus) public PausableModule(_nexus) {}
}