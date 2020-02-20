pragma solidity ^0.5.16;

import { MiniMeToken } from "minimetoken/contracts/MiniMeToken.sol";
import { ISystok } from "../interfaces/ISystok.sol";


contract Systok is ISystok, MiniMeToken {

  /**
   * @dev Systok just parameterises the MiniMeToken
   */
    constructor(
        address _tokenFactory,
        address _nexus,
        address _initialRecipient
    )
        public
        MiniMeToken(
            _tokenFactory,
            address(0x0),
            0,
            "mStable Meta",
            18,
            "MTA",
            true,
            false,
            _nexus
        )
    {
        generateTokens(_initialRecipient, 100000000 * (10 ** 18));
    }
}