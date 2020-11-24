pragma solidity 0.5.16;

import {
    IAaveATokenV1,
    IAaveATokenV2,
    IAaveLendingPoolV1,
    IAaveLendingPoolV2,
    ILendingPoolAddressesProviderV1,
    ILendingPoolAddressesProviderV2
} from "../../../masset/platform-integrations/IAave.sol";
import { AaveIntegration } from "../../../masset/platform-integrations/AaveIntegration.sol";
import { AaveV2Integration } from "../../../masset/platform-integrations/AaveV2Integration.sol";

import { MassetHelpers, SafeERC20, SafeMath } from "../../../masset/shared/MassetHelpers.sol";
import { StableMath } from "../../../shared/StableMath.sol";
import { IERC20, ERC20, ERC20Mintable } from "@openzeppelin/contracts/token/ERC20/ERC20Mintable.sol";
import { ERC20Burnable } from "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";


// 1. User calls 'getLendingPool'
// 2. User calls 'deposit' (Aave)
//  - Deposit their underlying
//  - Mint aToken to them
// 3. User calls redeem (aToken)
//  - Retrieve their aToken
//  - Return equal amount of underlying

contract MockAToken is ERC20Mintable {

    address public lendingPool;
    IERC20 public underlyingToken;
    using SafeERC20 for IERC20;

    constructor(address _lendingPool, IERC20 _underlyingToken) public {
        lendingPool = _lendingPool;
        underlyingToken = _underlyingToken;
        addMinter(_lendingPool);
    }

    function redeem(uint256 _amount) external {
        // Redeem these a Tokens
        _burn(msg.sender, _amount);
        // For the underlying
        underlyingToken.safeTransferFrom(lendingPool, msg.sender, _amount);
    }
}


contract MockATokenV2 is ERC20Mintable {

    address public lendingPool;
    IERC20 public underlyingToken;
    using SafeERC20 for IERC20;

    constructor(address _lendingPool, IERC20 _underlyingToken) public {
        lendingPool = _lendingPool;
        underlyingToken = _underlyingToken;
        addMinter(_lendingPool);
    }

    function burn(address user, uint256 amount) public {
        _burn(user, amount);
    }
}



contract MockAaveV1 is IAaveLendingPoolV1, ILendingPoolAddressesProviderV1 {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    mapping(address => address) reserveToAToken;
    address pool = address(this);
    address payable core = address(uint160(address(this)));

    function addAToken(address _aToken, address _underlying) public {
        MassetHelpers.safeInfiniteApprove(_underlying, _aToken);
        reserveToAToken[_underlying] = _aToken;
    }

    function deposit(address _reserve, uint256 _amount, uint16 /*_referralCode*/) external {
        uint256 previousBal = IERC20(reserveToAToken[_reserve]).balanceOf(msg.sender);
        uint256 factor = 2 * (10**13); // 0.002%
        uint256 interest = previousBal.mul(factor).div(1e18);
        ERC20Mintable(reserveToAToken[_reserve]).mint(msg.sender, interest);
        // Take their reserve
        transferTokens(msg.sender, address(this), _reserve, true, _amount);
        // Credit them with aToken
        ERC20Mintable(reserveToAToken[_reserve]).mint(msg.sender, _amount);
    }


    function transferTokens(
        address _sender,
        address _recipient,
        address _basset,
        bool _hasTxFee,
        uint256 _qty
    )
        internal
        returns (uint256 receivedQty)
    {
        receivedQty = _qty;
        if(_hasTxFee) {
            uint256 balBefore = IERC20(_basset).balanceOf(_recipient);
            IERC20(_basset).safeTransferFrom(_sender, _recipient, _qty);
            uint256 balAfter = IERC20(_basset).balanceOf(_recipient);
            receivedQty = StableMath.min(_qty, balAfter.sub(balBefore));
        } else {
            IERC20(_basset).safeTransferFrom(_sender, _recipient, _qty);
        }
    }

    function getLendingPool() external view returns (address) {
        return pool;
    }

    function getLendingPoolCore() external view returns (address payable) {
        return core;
    }

    function breakLendingPools() external {
        pool = address(0);
        core = address(uint160(address(0)));
    }

    function migrateLendingPools(address payable _new) external {
        pool = _new;
        core = _new;
    }
}


contract MockAaveV2 is IAaveLendingPoolV2, ILendingPoolAddressesProviderV2 {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    mapping(address => address) reserveToAToken;
    address pool = address(this);
    address payable core = address(uint160(address(this)));

    function addAToken(address _aToken, address _underlying) public {
        MassetHelpers.safeInfiniteApprove(_underlying, _aToken);
        reserveToAToken[_underlying] = _aToken;
    }

    function deposit(address _reserve, uint256 _amount, address /* _onBehalfOf */, uint16 /*_referralCode*/) external {
        uint256 previousBal = IERC20(reserveToAToken[_reserve]).balanceOf(msg.sender);
        uint256 factor = 2 * (10**13); // 0.002%
        uint256 interest = previousBal.mul(factor).div(1e18);
        ERC20Mintable(reserveToAToken[_reserve]).mint(msg.sender, interest);
        // Take their reserve
        transferTokens(msg.sender, address(this), _reserve, true, _amount);
        // Credit them with aToken
        ERC20Mintable(reserveToAToken[_reserve]).mint(msg.sender, _amount);
    }

    function withdraw(
        address reserve,
        uint256 amount,
        address to
    ) external {
        MockATokenV2(reserveToAToken[reserve]).burn(msg.sender, amount);
        IERC20(reserve).transfer(to, amount);
    }

    function getLendingPool() external view returns (address) {
        return pool;
    }

    function breakLendingPools() external {
        pool = address(0);
        core = address(uint160(address(0)));
    }


    function transferTokens(
        address _sender,
        address _recipient,
        address _basset,
        bool _hasTxFee,
        uint256 _qty
    )
        internal
        returns (uint256 receivedQty)
    {
        receivedQty = _qty;
        if(_hasTxFee) {
            uint256 balBefore = IERC20(_basset).balanceOf(_recipient);
            IERC20(_basset).safeTransferFrom(_sender, _recipient, _qty);
            uint256 balAfter = IERC20(_basset).balanceOf(_recipient);
            receivedQty = StableMath.min(_qty, balAfter.sub(balBefore));
        } else {
            IERC20(_basset).safeTransferFrom(_sender, _recipient, _qty);
        }
    }
}


contract MockAaveIntegration is AaveIntegration {

    // event CurrentBalance(address indexed bAsset, uint256 balance);

    function logBalance(address _bAsset)
        external
        view
        returns (uint256 balance)
    {
        // balance is always with token aToken decimals
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);
        balance = _checkBalance(aToken);

        // emit CurrentBalance(_bAsset, balance);
    }

    function getBassetsMapped()
        external
        view
        returns (address[] memory bassets)
    {
        return bAssetsMapped;
    }
}


contract MockAaveV2Integration is AaveV2Integration {

    function getBassetsMapped()
        external
        view
        returns (address[] memory bassets)
    {
        return bAssetsMapped;
    }
}
