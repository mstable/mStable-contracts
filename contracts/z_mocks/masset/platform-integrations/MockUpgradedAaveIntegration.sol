pragma solidity 0.5.16;

import { InitializableAbstractIntegration, MassetHelpers, IERC20 } from "../../../masset/platform-integrations/InitializableAbstractIntegration.sol";

import { IAaveATokenV1, IAaveLendingPoolV1, ILendingPoolAddressesProviderV1 } from "../../../masset/platform-integrations/IAave.sol";

contract AaveIntegrationV2 is InitializableAbstractIntegration {

    // new variable
    uint256 public newUint = 1;

    /***************************************
                    CORE
    ****************************************/

    function deposit(
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    )
        external
        onlyWhitelisted
        returns (uint256 quantityDeposited)
    {
        // Get the Target token
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);

        // We should have been sent this amount, if not, the deposit will fail
        quantityDeposited = _amount;

        uint16 referralCode = 9999; // temp code

        if(_hasTxFee) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(aToken);
            _getLendingPool().deposit(address(_bAsset), _amount, referralCode);
            uint256 newBal = _checkBalance(aToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            // aTokens are 1:1 for each asset
            _getLendingPool().deposit(address(_bAsset), _amount, referralCode);
        }

        emit Deposit(_bAsset, address(aToken), quantityDeposited);
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool /*_hasTxFee*/
    )
        external
        onlyWhitelisted
    {
        _withdraw(_receiver, _bAsset, _amount, _totalAmount, true);
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool /*_hasTxFee*/
    )
        external
        onlyWhitelisted
    {
        _withdraw(_receiver, _bAsset, _amount, _amount, true);
    }

    function _withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool /*_hasTxFee*/
    )
        internal
    {
        // Get the Target token
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);

        // Don't need to Approve aToken, as it gets burned in redeem()
        aToken.redeem(_totalAmount);

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(aToken), _amount);
    }



    function withdrawRaw(address _receiver, address _bAsset, uint256 _amount) external {

        IERC20(_bAsset).safeTransfer(_receiver, _amount);
        emit Withdrawal(_bAsset, address(0), _amount);
    }

    // FUNCTION DEFINITION MODIFIED
    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token aToken decimals
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);
        // ADDED 100 to the token balance just to check upgrade
        return _checkBalance(aToken).add(100);
    }


    /***************************************
                    APPROVALS
    ****************************************/

    function reApproveAllTokens()
        external
        onlyGovernor
    {
        uint256 bAssetCount = bAssetsMapped.length;
        address lendingPoolVault = _getLendingPoolCore();
        // approve the pool to spend the bAsset
        for(uint i = 0; i < bAssetCount; i++){
            MassetHelpers.safeInfiniteApprove(bAssetsMapped[i], lendingPoolVault);
        }
    }

    function _abstractSetPToken(address _bAsset, address /*_pToken*/)
        internal
    {
        address lendingPoolVault = _getLendingPoolCore();
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, lendingPoolVault);
    }

    function _abstractUpdatePToken(address _bAsset, address _oldPToken, address _pToken)
        internal
    {
        // No need to re-approve the pool, as it already has access to this bAsset
    }

    /***************************************
                    HELPERS
    ****************************************/

    function _getLendingPool()
        internal
        view
        returns (IAaveLendingPoolV1)
    {
        address lendingPool = ILendingPoolAddressesProviderV1(platformAddress).getLendingPool();
        require(lendingPool != address(0), "Lending pool does not exist");
        return IAaveLendingPoolV1(lendingPool);
    }

    function _getLendingPoolCore()
        internal
        view
        returns (address)
    {
        address lendingPoolCore = ILendingPoolAddressesProviderV1(platformAddress).getLendingPoolCore();
        require(lendingPoolCore != address(0), "Lending pool does not exist");
        return lendingPoolCore;
    }

    function _getATokenFor(address _bAsset)
        internal
        view
        returns (IAaveATokenV1)
    {
        address aToken = bAssetToPToken[_bAsset];
        require(aToken != address(0), "aToken does not exist");
        return IAaveATokenV1(aToken);
    }

    function _checkBalance(IAaveATokenV1 _aToken)
        internal
        view
        returns (uint256 balance)
    {
        return _aToken.balanceOf(address(this));
    }

    // NEW FUNCTIONS
    // ===============
    function initializeNewUint() external onlyProxyAdmin {
        newUint = 1;
    }

    function newMethod() public pure returns (bool) {
        return true;
    }

    // MODIFIED FUNCTIONS
    // ==================
    function setPTokenAddress(address /*_bAsset*/, address /*_pToken*/)
        external
        onlyGovernor
    {
        // This is just to test upgradibility
        revert("Not allowed to add more pTokens");
    }


}

contract AaveIntegrationV3 is InitializableAbstractIntegration {

    uint256 public newUint = 1;

    /***************************************
                    CORE
    ****************************************/

    function deposit(
        address _bAsset,
        uint256 _amount,
        bool _hasTxFee
    )
        external
        onlyWhitelisted
        returns (uint256 quantityDeposited)
    {
        // Get the Target token
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);

        // We should have been sent this amount, if not, the deposit will fail
        quantityDeposited = _amount;

        uint16 referralCode = 9999; // temp code

        if(_hasTxFee) {
            // If we charge a fee, account for it
            uint256 prevBal = _checkBalance(aToken);
            _getLendingPool().deposit(address(_bAsset), _amount, referralCode);
            uint256 newBal = _checkBalance(aToken);
            quantityDeposited = _min(quantityDeposited, newBal.sub(prevBal));
        } else {
            // aTokens are 1:1 for each asset
            _getLendingPool().deposit(address(_bAsset), _amount, referralCode);
        }

        emit Deposit(_bAsset, address(aToken), quantityDeposited);
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool /*_hasTxFee*/
    )
        external
        onlyWhitelisted
    {
        _withdraw(_receiver, _bAsset, _amount, _totalAmount, true);
    }

    function withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        bool /*_hasTxFee*/
    )
        external
        onlyWhitelisted
    {
        _withdraw(_receiver, _bAsset, _amount, _amount, true);
    }

    function _withdraw(
        address _receiver,
        address _bAsset,
        uint256 _amount,
        uint256 _totalAmount,
        bool /*_hasTxFee*/
    )
        internal
    {
        // Get the Target token
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);

        // Don't need to Approve aToken, as it gets burned in redeem()
        aToken.redeem(_totalAmount);

        // Send redeemed bAsset to the receiver
        IERC20(_bAsset).safeTransfer(_receiver, _amount);

        emit Withdrawal(_bAsset, address(aToken), _amount);
    }
    function withdrawRaw(address _receiver, address _bAsset, uint256 _amount) external {

        IERC20(_bAsset).safeTransfer(_receiver, _amount);
        emit Withdrawal(_bAsset, address(0), _amount);
    }

    function checkBalance(address _bAsset)
        external
        returns (uint256 balance)
    {
        // balance is always with token aToken decimals
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);
        // ADDED 100 to the token balance just to check upgrade
        return _checkBalance(aToken).add(100);
    }


    /***************************************
                    APPROVALS
    ****************************************/

    function reApproveAllTokens()
        external
        onlyGovernor
    {
        uint256 bAssetCount = bAssetsMapped.length;
        address lendingPoolVault = _getLendingPoolCore();
        // approve the pool to spend the bAsset
        for(uint i = 0; i < bAssetCount; i++){
            MassetHelpers.safeInfiniteApprove(bAssetsMapped[i], lendingPoolVault);
        }
    }

    function _abstractSetPToken(address _bAsset, address /*_pToken*/)
        internal
    {
        address lendingPoolVault = _getLendingPoolCore();
        // approve the pool to spend the bAsset
        MassetHelpers.safeInfiniteApprove(_bAsset, lendingPoolVault);
    }

    function _abstractUpdatePToken(address _bAsset, address _oldPToken, address _pToken)
        internal
    {
        // No need to re-approve the pool, as it already has access to this bAsset
    }

    /***************************************
                    HELPERS
    ****************************************/

    function _getLendingPool()
        internal
        view
        returns (IAaveLendingPoolV1)
    {
        address lendingPool = ILendingPoolAddressesProviderV1(platformAddress).getLendingPool();
        require(lendingPool != address(0), "Lending pool does not exist");
        return IAaveLendingPoolV1(lendingPool);
    }

    // NEW
    function checkBalanceView(address _bAsset)
        external
        view
        returns (uint256 balance)
    {
        // balance is always with token aToken decimals
        IAaveATokenV1 aToken = _getATokenFor(_bAsset);
        // ADDED 100 to the token balance just to check upgrade
        return _checkBalance(aToken);
    }

    function _getLendingPoolCore()
        internal
        view
        returns (address)
    {
        address lendingPoolCore = ILendingPoolAddressesProviderV1(platformAddress).getLendingPoolCore();
        require(lendingPoolCore != address(0), "Lending pool does not exist");
        return lendingPoolCore;
    }

    function _getATokenFor(address _bAsset)
        internal
        view
        returns (IAaveATokenV1)
    {
        address aToken = bAssetToPToken[_bAsset];
        require(aToken != address(0), "aToken does not exist");
        return IAaveATokenV1(aToken);
    }

    function _checkBalance(IAaveATokenV1 _aToken)
        internal
        view
        returns (uint256 balance)
    {
        return _aToken.balanceOf(address(this));
    }

    // NEW FUNCTIONS
    // ===============
    function initializeNewUint() external onlyProxyAdmin {
        newUint = 1;
    }

    // Deleted from V3
    /*
    function newMethod() public pure returns (bool) {
        return true;
    }
    */

    // MODIFIED FUNCTIONS
    // ==================
    function setPTokenAddress(address /* _bAsset*/, address /*_pToken*/)
        external
        onlyGovernor
    {
        // This is just to test upgradibility
        revert("Not allowed to add more pTokens");
    }


}