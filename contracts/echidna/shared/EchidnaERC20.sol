pragma solidity 0.5.16;

import "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { EchidnaInterface } from "../interfaces.sol";


//Validation may occur via slither checker 
contract EchidnaERC20 is ERC20, ERC20Detailed, ERC20Mintable {

    constructor (
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    )
        ERC20Detailed(
            _name,
            _symbol,
            _decimals
        )
        public
    {
        _mint(_initialRecipient, _initialMint.mul(10 ** uint256(_decimals)));
    }
}

contract EchidnaUSDT {
    function setParams(uint newBasisPoints, uint newMaxFee) public;
}
