pragma solidity 0.5.16;

import { AbstractIntegration, MassetHelpers, IERC20 } from "./AbstractIntegration.sol";

import { ICERC20 } from "./ICompound.sol";

contract CompoundIntegration is AbstractIntegration {

    constructor(
        address _nexus,
        address[] memory _whitelisted,
        address _compoundAddress
    )
        AbstractIntegration(
            _nexus,
            _whitelisted,
            _compoundAddress
        )
        public
    {
    }

    /***************************************
                    CORE
    ****************************************/

    function deposit(
        address _spender,
        address _bAsset,
        uint256 _amount,
        bool _isTokenFeeCharged
    )
        external
        onlyWhitelisted
        returns (uint256 quantityDeposited)
    {
        // Get the Target token
        ICERC20 cToken = _getCTokenFor(_bAsset);

        // Transfer collateral to this address
        quantityDeposited = MassetHelpers.transferTokens(_spender, address(this), _bAsset, _isTokenFeeCharged, _amount);

        if(_isTokenFeeCharged) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(cToken);
            assert(cToken.mint(_amount) == 0);
            uint256 newBal = _checkBalance(cToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            // Else just execute the mint
            assert(cToken.mint(_amount) == 0);
        }

        emit Deposit(_bAsset, address(cToken), quantityDeposited);
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount
    )
        external
        onlyWhitelisted
    {
        // Get the Target token
        ICERC20 cToken = _getCTokenFor(_bAsset);

        // Redeem Underlying bAsset amount
        require(cToken.redeemUnderlying(_amount) == 0, "something went wrong");

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(cToken), _amount);
    }

    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token cToken decimals
        ICERC20 cToken = _getCTokenFor(_bAsset);
        return _checkBalance(cToken);
    }

    /***************************************
                    APPROVALS
    ****************************************/

    function reApproveAllTokens()
        external
        onlyGovernor
    {
        uint256 bAssetCount = bAssetsMapped.length;
        for(uint i = 0; i < bAssetCount; i++){
            address bAsset = bAssetsMapped[i];
            address cToken = bAssetToPToken[bAsset];
            MassetHelpers.safeInfiniteApprove(bAssetsMapped[i], cToken);
        }
    }

    function _abstractSetPToken(address _bAsset, address _cToken)
        internal
    {
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, _cToken);
    }

    function _abstractUpdatePToken(address _bAsset, address _oldCToken, address _newCToken)
        internal
    {
        // Clean up old allowance
        IERC20(_bAsset).safeApprove(_oldCToken, 0);
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, _newCToken);
    }

    /***************************************
                    HELPERS
    ****************************************/

    function _getCTokenFor(address _bAsset)
        internal
        view
        returns (ICERC20)
    {
        address cToken = bAssetToPToken[_bAsset];
        require(cToken != address(0), "cToken does not exist");
        return ICERC20(cToken);
    }

    function _checkBalance(ICERC20 _cToken)
        internal
        returns (uint256 balance)
    {
        return _cToken.balanceOfUnderlying(address(this));
    }
}