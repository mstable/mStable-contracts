pragma solidity 0.5.16;

import { ERC20Detailed } from "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title  MassetToken
 * @author Stability Labs Pty. Ltd.
 * @dev    Basic ERC20Detailed Token functionality for Masset
 */
contract MassetToken is ERC20, ERC20Detailed {

    constructor (
        string memory _name,
        string memory _symbol
    )
        ERC20Detailed(
            _name,
            _symbol,
            18
        )
        internal
    { }


}