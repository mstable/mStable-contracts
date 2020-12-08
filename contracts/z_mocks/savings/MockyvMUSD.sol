
pragma solidity ^0.5.16;


import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Detailed } from "@openzeppelin/contracts/token/ERC20/ERC20Detailed.sol";
import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

contract yvMUSD is ERC20 {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IERC20 public token;
    
    string public name;
    string public symbol;
    uint8 public decimals;

    constructor (address _token) public {
        name = string(abi.encodePacked("yearn ", ERC20Detailed(_token).name()));
        symbol = string(abi.encodePacked("yv", ERC20Detailed(_token).symbol()));

        decimals = ERC20Detailed(_token).decimals();
        token = IERC20(_token);
    }
    

    function balance() public view returns (uint) {
        // todo - increase balance here to increase price per share
        return token.balanceOf(address(this));
    }

    function depositAll() external {
        deposit(token.balanceOf(msg.sender));
    }

    function deposit(uint _amount) public {
        uint _pool = balance();
        token.safeTransferFrom(msg.sender, address(this), _amount);
        uint shares = 0;
        if (totalSupply() == 0) {
            shares = _amount;
        } else {
            shares = (_amount.mul(totalSupply())).div(_pool);
        }
        _mint(msg.sender, shares);
    }

    function withdrawAll() external {
        withdraw(balanceOf(msg.sender));
    }

    function withdraw(uint _shares) public {
        uint r = (balance().mul(_shares)).div(totalSupply());
        _burn(msg.sender, _shares);
        token.safeTransfer(msg.sender, r);
    }

    function getPricePerFullShare() public view returns (uint) {
        return balance().mul(1e18).div(totalSupply());
    }
}