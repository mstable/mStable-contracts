
pragma solidity ^0.5.12;

import { Nexus } from "../../nexus/Nexus.sol";

/**
 * @title NexusMock
 */
contract NexusMock is Nexus {


    constructor(
        address _governor
    )
        Nexus(
            _governor
        )
        public
    {}

}
