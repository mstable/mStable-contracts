pragma solidity 0.5.16;

import { CompoundIntegration, ICERC20 } from "../../../masset/platform-integrations/CompoundIntegration.sol";



contract EchidnaCompoundIntegration is CompoundIntegration {

    event CurrentBalance(address indexed bAsset, uint256 balance);

    // Only emits log, no echidna check needed 
    function logBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token cToken decimals
        ICERC20 cToken = _getCTokenFor(_bAsset);
        balance = _checkBalance(cToken);

        emit CurrentBalance(_bAsset, balance);
    }
}

// Echidna contract to run Echidna fuzz `checkBalance`
contract EchidnaCompoundIntegration2 is CompoundIntegration {

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

    function echidna_validate_custom_bal() public returns(bool){
        uint256 bal1 = bal;
        setCustomBalance(4);
        return bal1 != bal;
    }

    function checkBalance(address /*_bAsset*/)
        external
        returns (uint256 balance)
    {
        balance = bal;
    }

}