pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { BasketManager } from "../../masset/BasketManager.sol";
import { MockNexus } from "../../z_mocks/nexus/MockNexus.sol";

contract BasketManagerEchidna is BasketManager {

    // address private constant echidna_sender = 0x00a329C0648769a73afAC7F9381e08fb43DBEA70;

    constructor() public {
        MockNexus n = new MockNexus(
            address(0x1),
            address(0x1),
            address(0x1)
        );
        nexus = n;
    }


    // TODO Still not working as expected
    function echidna_num_bassets_always_le_max_basset() public view returns (bool) {
        Basset[] memory bassets = basket.bassets;
        // TODO wrong property, must fail, but its not.
        return bassets.length <= 10;
    }

}