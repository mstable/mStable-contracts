
pragma solidity ^0.5.12;

import { Systok, INexus } from "../../systok/Systok.sol";

/**
 * @title SystokMock
 */
contract SystokMock is Systok {


    constructor(
        INexus _nexus,
        address _initialRecipient
    )
        Systok(
            _nexus,
            _initialRecipient
        )
        public
    {}

}
