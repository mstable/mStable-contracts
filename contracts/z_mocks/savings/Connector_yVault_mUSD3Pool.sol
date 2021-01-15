pragma solidity 0.5.16;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "../../savings/peripheral/IConnector.sol";
import { StableMath, SafeMath } from "../../shared/StableMath.sol";

contract IyVault is ERC20 {

    function deposit(uint256 _amount) public;
    function depositAll() external;

    function withdraw(uint256 _shares) public;
    function withdrawAll() external;

    function getPricePerFullShare() public view returns (uint256);
}

contract ICurve_DepositMUSD {
    function add_liquidity(uint256[] calldata amounts, uint256 min_mint_amount) external;
    function remove_liquidity_one_coin(uint256 _token_amount, int128 i, uint256 min_amount) external;
}

contract ICurve_ExchangeMUSD {
    function get_virtual_price() external view returns(uint256);
}

// TODO - Complete implementation and ensure flash loan proof
contract Connector_yVault_mUSD3Pool is IConnector {

    using StableMath for uint256;
    using SafeMath for uint256;

    address save;
    address curve_deposit;
    address curve_exchange;
    address yVault;
    address mUSD;

    constructor(
        address _save, // constant
        address _yVault, // constant
        address _mUSD // constant
    ) public {
        save = _save;
        yVault = _yVault;
        mUSD = _mUSD;
        IERC20(_mUSD).approve(_yVault, uint256(-1));
    }

    modifier onlySave() {
        require(save == msg.sender, "Only SAVE can call this");
        _;
    }

    // Steps:
    //  - Deposit mUSD in curve_deposit
    //  - Deposit mUSD3Pool LP into yVault
    // https://github.com/iearn-finance/yearn-protocol/blob/develop/contracts/strategies/StrategyUSDT3pool.sol#L78
    function deposit(uint256 _amt) external onlySave {
        // TODO - if using meta pool LP token, account for coordinated flash loan scenario
        IERC20(mUSD).transferFrom(save, address(this), _amt);
        IyVault(yVault).deposit(_amt);
    }

    // Steps:
    //  - Withdraw mUSD3Pool LP from yVault
    //  - Withdraw mUSD from in curve_deposit
    function withdraw(uint256 _amt) external onlySave {
        // TODO - if using meta pool LP token, account for coordinated flash loan scenario
        // amount = shares * sharePrice
        // shares = amount / sharePrice
        uint256 sharePrice = IyVault(yVault).getPricePerFullShare();
        uint256 sharesToWithdraw = _amt.divPrecisely(sharePrice);
        IyVault(yVault).withdraw(sharesToWithdraw);
        IERC20(mUSD).transfer(save, _amt);
    }

    function withdrawAll() external onlySave {
        // getBalanceOf shares
        // withdraw all
        // send all to save
    }

    // Steps:
    //  - Get total mUSD3Pool balance held in yVault
    //    - Get yVault share balance
    //    - Get yVault share to mUSD3Pool ratio
    //  - Get exchange rate between mUSD3Pool LP and mUSD (virtual price?)
    // To consider: if using virtual price, and mUSD is initially traded at a discount,
    // then depositing 10k mUSD is likely to net a virtual amount of 9.97k or so. Can either take
    // a deficit to begin with, or track the amount of units deposited
    function checkBalance() external view returns (uint256) {
        // TODO - if using meta pool LP token, account for coordinated flash loan scenario
        uint256 sharePrice = IyVault(yVault).getPricePerFullShare();
        uint256 shares = IERC20(yVault).balanceOf(address(this));
        return shares.mulTruncate(sharePrice);
    }

    function _shareToMUSDRate() internal view returns (uint256) {
        // mUSD3Pool LP balance = shares * sharePrice
        // USD value = mUSD3Pool LP * virtual price
    }
}