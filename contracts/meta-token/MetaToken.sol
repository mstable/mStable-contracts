pragma solidity ^0.5.16;

import { MiniMeToken } from "minimetoken/contracts/MiniMeToken.sol";
import { IMetaToken } from "../interfaces/IMetaToken.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract MetaToken is IMetaToken, MiniMeToken {

    using SafeMath for uint256;

    /**
     * @dev MetaToken just parameterises the MiniMeToken
     */
    constructor(
        address _tokenFactory,
        address _initialRecipient
    )
        public
        MiniMeToken(
            _tokenFactory,
            address(0x0),
            0,
            "Meta",
            18,
            "MTA",
            true
        )
    {
        _generateTokens(_initialRecipient, 100000000 * (10 ** 18));
    }


    /***************************************
                    FUNCS
    ****************************************/

    // function destroyTokens || burn
    // This would allow burns of a users own balance, or their approved balance,
    // and require access to the destroy tokens func
    // e.g.
    // function burn(uint256 amount) public {
    //     _balances[account] = _balances[msg.sender].sub(amount, "ERC20: burn amount exceeds balance");
    //     _totalSupply = _totalSupply.sub(amount);
    //     emit Transfer(account, address(0), amount);
    // }

    // Copied from https://github.com/OpenZeppelin/openzeppelin-contracts-ethereum-package/blob/master/contracts/token/ERC20/ERC20.sol#118
    function increaseAllowance(address spender, uint256 addedValue) public returns (bool) {
        _approve(spender, allowed[msg.sender][spender].add(addedValue));
        return true;
    }

    // Copied from https://github.com/OpenZeppelin/openzeppelin-contracts-ethereum-package/blob/master/contracts/token/ERC20/ERC20.sol#137
    function decreaseAllowance(address spender, uint256 subtractedValue) public returns (bool) {
        _approve(spender, allowed[msg.sender][spender].sub(subtractedValue));
        return true;
    }
}