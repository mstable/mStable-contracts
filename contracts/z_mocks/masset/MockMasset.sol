pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MockERC20 } from "../shared/MockERC20.sol";
import { Masset } from "../../masset/Masset.sol";

contract MockMasset is MockERC20 {

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    )
        public
        MockERC20(
            _name,
            _symbol,
            _decimals,
            _initialRecipient,
            _initialMint
        )

    {}

    uint256 private amountToMint = 0;

    // Inject amount of tokens to mint
    function setAmountForCollectInterest(uint256 _amount) public {
        amountToMint = _amount;
    }

    function collectInterest()
        external
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        _mint(msg.sender, amountToMint);
        totalInterestGained = amountToMint;
        newSupply = totalSupply();
        // Set back to zero
        amountToMint = 0;
    }

}
contract MockMasset1 is MockERC20 {

    constructor(
        string memory _name,
        string memory _symbol,
        uint8 _decimals,
        address _initialRecipient,
        uint256 _initialMint
    )
        public
        MockERC20(
            _name,
            _symbol,
            _decimals,
            _initialRecipient,
            _initialMint
        )

    {}

    uint256 private amountToMint = 0;

    // Inject amount of tokens to mint
    function setAmountForCollectInterest(uint256 _amount) public {
        amountToMint = _amount;
    }

    function collectInterest()
        external
        returns (uint256 totalInterestGained, uint256 newSupply)
    {
        totalInterestGained = amountToMint;
        newSupply = totalSupply();
        // Set back to zero
        amountToMint = 0;
    }

}

// Upgradable Masset contract to use in manual beta-testing
contract UpgradableMassetV2 is Masset {
    string public version = "";
    uint256 private NEW_MAX_FEE = 0;

    function init() public {
        version = "v2";
        NEW_MAX_FEE = 2e16;
    }

    function setSwapFee(uint256 _swapFee)
        external
        onlyGovernor
    {
        revert("Disabled in v2");
    }

    function setSwapFeeOriginal(uint256 _swapFee)
        external
        onlyGovernor
    {
        require(_swapFee <= NEW_MAX_FEE, "Rate must be within bounds");
        swapFee = _swapFee;

        emit SwapFeeChanged(_swapFee);
    }
}