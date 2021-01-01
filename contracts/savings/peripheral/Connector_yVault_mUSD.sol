pragma solidity 0.5.16;

import { IERC20, ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IConnector } from "./IConnector.sol";
import { StableMath, SafeMath } from "../../shared/StableMath.sol";

contract IyVault is ERC20 {

    function deposit(uint256 _amount) public;
    function depositAll() external;

    function withdraw(uint256 _shares) public;
    function withdrawAll() external;

    function getPricePerFullShare() public view returns (uint256);
}


// TODO - Complete implementation and ensure flash loan proof
contract Connector_yVault_mUSD is IConnector {

    using StableMath for uint256;
    using SafeMath for uint256;

    address save;
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

    function deposit(uint256 _amt) external onlySave {
        // TODO - if using meta pool LP token, account for coordinated flash loan scenario
        IERC20(mUSD).transferFrom(save, address(this), _amt);
        IyVault(yVault).deposit(_amt);
    }

    function withdraw(uint256 _amt) external onlySave {
        // TODO - if using meta pool LP token, account for coordinated flash loan scenario
        // amount = shares * sharePrice
        // shares = amount / sharePrice
        uint256 sharePrice = IyVault(yVault).getPricePerFullShare();
        uint256 sharesToWithdraw = _amt.divPrecisely(sharePrice);
        IyVault(yVault).withdraw(sharesToWithdraw);
        IERC20(mUSD).transfer(save, _amt);
    }

    function withdrawAll(uint256 _amt) external onlySave {
        // getBalanceOf shares
        // withdraw all
        // send all to save
    }

    function checkBalance() external view returns (uint256) {
        // TODO - if using meta pool LP token, account for coordinated flash loan scenario
        uint256 sharePrice = IyVault(yVault).getPricePerFullShare();
        uint256 shares = IERC20(yVault).balanceOf(address(this));
        return shares.mulTruncate(sharePrice);
    }
}