pragma solidity ^0.5.16;

import { MiniMeToken } from "minimetoken/contracts/MiniMeToken.sol";
import { ISystok } from "../interfaces/ISystok.sol";
import { Module } from "../shared/Module.sol";


contract Systok is ISystok, Module, MiniMeToken {

  /**
   * @dev Systok just parameterises the MiniMeToken
   */
    constructor(
        address _tokenFactory,
        address _nexus,
        address _initialRecipient
    )
        public
        Module(_nexus)
        MiniMeToken(
            _tokenFactory,
            address(0x0),
            0,
            "mStable Meta",
            18,
            "MTA",
            true
        )
    {
        generateTokens(_initialRecipient, 100000000 * (10 ** 18));
    }

    modifier onlyMinter() {
        require(msg.sender == controller || msg.sender == _recollateraliser(), "Only minter can execute");
        _;
    }

    /***************************************
                  OVERRIDES
    ****************************************/

    function generateTokens(address _owner, uint _amount) public onlyMinter returns (bool) {
        return _generateTokens(_owner, _amount);
    }

    function enableTransfers(bool _transfersEnabled) public onlyController {
        // Do nothing, we should never disable transfers
    }

    /***************************************
                    FUNCS
    ****************************************/

    // function destroyTokens || burn
    // function increaseApproval
    // function decreaseApproval
}