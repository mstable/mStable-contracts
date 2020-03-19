pragma solidity 0.5.16;

import { IAaveAToken, IAaveLendingPool, ILendingPoolAddressesProvider } from "../../../masset/platform-integrations/IAave.sol";

import { MassetHelpers } from "../../../masset/shared/MassetHelpers.sol";
import { IERC20, ERC20, ERC20Mintable } from "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";


// 1. User calls 'getLendingPool'
// 2. User calls 'deposit' (Aave)
//  - Deposit their underlying
//  - Mint aToken to them
// 3. User calls redeem (aToken)
//  - Retrieve their aToken
//  - Return equal amount of underlying

contract MockAToken is ERC20Mintable {

    address public lendingPool;
    ERC20 public underlyingToken;

    constructor(address _lendingPool, ERC20 _underlyingToken) public {
        lendingPool = _lendingPool;
        underlyingToken = _underlyingToken;
        addMinter(_lendingPool);
    }

    function redeem(uint256 _amount) external {
        // Redeem these a Tokens
        _burn(msg.sender, _amount);
        // For the underlying
        underlyingToken.transferFrom(lendingPool, msg.sender, _amount);
    }
}

contract MockAave is IAaveLendingPool, ILendingPoolAddressesProvider {

    mapping(address => address) reserveToAToken;

    function addAToken(address _aToken, address _underlying) public {
        MassetHelpers.safeInfiniteApprove(_underlying, _aToken);
        reserveToAToken[_underlying] = _aToken;
    }

    function deposit(address _reserve, uint256 _amount, uint16 /*_referralCode*/) external {
        // Take their reserve
        ERC20(_reserve).transferFrom(msg.sender, address(this), _amount);
        // Credit them with aToken
        ERC20Mintable(reserveToAToken[_reserve]).mint(msg.sender, _amount);
    }

    function getLendingPool() external view returns (address) {
        return address(this);
    }

    function getLendingPoolCore() external view returns (address payable) {
        return address(uint160(address(this)));
    }

}