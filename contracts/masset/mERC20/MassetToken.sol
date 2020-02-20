pragma solidity ^0.5.12;

import { StableMath } from "../../shared/math/StableMath.sol";
import { ERC20Detailed, ERC20, IERC20 } from "./MERC20Detailed.sol";


/**
 * @dev Extension of `ERC20` that allows token holders to destroy both their own
 * tokens and those that they have an allowance for, in a way that can be
 * recognized off-chain (via event analysis).
 */
contract ERC20Burnable is ERC20 {
    /**
     * @dev Destoys `amount` tokens from the caller.
     *
     * See `ERC20._burn`.
     */
    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }

    /**
     * @dev See `ERC20._burnFrom`.
     */
    function burnFrom(address account, uint256 amount) public {
        _burnFrom(account, amount);
    }
}


/**
 * @title MassetToken
 * @dev Basic Token functionality for Masset
 */
contract MassetToken is ERC20Detailed, ERC20Burnable {

    /** @dev constructor - create a burnable, mintable ERC20 token */
    constructor (
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    )
        ERC20Detailed(
            _name,
            _symbol,
            _decimals
        )
        public
    { }
}