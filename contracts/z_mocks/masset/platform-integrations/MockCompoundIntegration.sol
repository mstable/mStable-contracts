pragma solidity 0.5.16;

import { CompoundIntegration, ICERC20, IERC20 } from "../../../masset/platform-integrations/CompoundIntegration.sol";


// Mock contract to mock `checkBalance`
contract MockCompoundIntegration2 is CompoundIntegration {

    event CurrentBalance(address indexed bAsset, uint256 balance);

    function logBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token cToken decimals
        ICERC20 cToken = _getCTokenFor(_bAsset);
        balance = _checkBalance(cToken);

        emit CurrentBalance(_bAsset, balance);
    }

    uint256 bal;
    // Inject custom balance
    function setCustomBalance(uint256 _bal) external {
        bal = _bal;
    }

    function checkBalance(address /*_bAsset*/)
        external
        returns (uint256 balance)
    {
        balance = bal;
    }

}