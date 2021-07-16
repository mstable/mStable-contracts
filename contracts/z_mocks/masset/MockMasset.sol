// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { MockERC20 } from "../shared/MockERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";

contract MockMasset is MockERC20 {
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    ) MockERC20(_name, _symbol, _decimals, _initialRecipient, _initialMint) {}

    function setRatio(uint256 _newRatio) external {
        ratio = _newRatio;
    }

    uint256 ratio = 98e16;
    uint256 private amountToMint = 0;
    uint256 private platformAmountToMint = 0;

    // Inject amount of tokens to mint
    function setAmountForCollectInterest(uint256 _amount) public {
        amountToMint = _amount;
    }

    // Inject amount of tokens to mint
    function setAmountForPlatformInterest(uint256 _amount) public {
        platformAmountToMint = _amount;
    }

    function collectInterest() external returns (uint256 totalInterestGained, uint256 newSupply) {
        _mint(msg.sender, amountToMint);
        totalInterestGained = amountToMint;
        newSupply = totalSupply();
        // Set back to zero
        amountToMint = 0;
    }

    function collectPlatformInterest()
        external
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        _mint(msg.sender, platformAmountToMint);
        totalInterestGained = platformAmountToMint;
        newSupply = totalSupply();
        // Set back to zero
        platformAmountToMint = 0;
    }

    function mint(
        address _input,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external returns (uint256) {
        uint256 decimals = IBasicToken(_input).decimals();
        uint256 out_amt = (_inputQuantity * (10**(18 - decimals)) * ratio) / 1e18;
        require(out_amt >= _minOutputQuantity, "MINT: Output amount not enough");
        IERC20(_input).transferFrom(msg.sender, address(this), _inputQuantity);
        _mint(_recipient, out_amt);
        return out_amt;
    }
}

contract MockMasset1 is MockERC20 {
    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    ) MockERC20(_name, _symbol, _decimals, _initialRecipient, _initialMint) {}

    uint256 private amountToMint = 0;

    // Inject amount of tokens to mint
    function setAmountForCollectInterest(uint256 _amount) public {
        amountToMint = _amount;
    }

    function collectInterest() external returns (uint256 totalInterestGained, uint256 newSupply) {
        totalInterestGained = amountToMint;
        newSupply = totalSupply();
        // Set back to zero
        amountToMint = 0;
    }
}
