pragma solidity 0.5.16;

import { CompoundIntegration, ICERC20, IERC20, MassetHelpers } from "../../../masset/platform-integrations/CompoundIntegration.sol";


// Overrides approveRewardToken
contract MockCompoundIntegration1 is CompoundIntegration {

    address rewardToken;

    // @override
    function approveRewardToken()
        external
    {
        address liquidator = nexus.getModule(keccak256("Liquidator"));
        require(liquidator != address(0), "Liquidator address cannot be zero");

        MassetHelpers.safeInfiniteApprove(rewardToken, liquidator);

        emit RewardTokenApproved(rewardToken, liquidator);
    }

    function setRewardToken(address _token) external {
        rewardToken = _token;
    }
}


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