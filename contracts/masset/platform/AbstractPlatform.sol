pragma solidity 0.5.16;

import { IPlatform } from "./IPlatform.sol";

import { WhitelistedRole } from "openzeppelin-solidity/contracts/access/roles/WhitelistedRole.sol";

import { MassetHelpers } from "../shared/MassetHelpers.sol";

contract AbstractPlatform is IPlatform, WhitelistedRole {

    string public constant version = "1.0";

    address public platformAddress;
    // bool internal pTokenRequiresApproval;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public bAssetToPToken;

    event PTokenAdded(address indexed _bAsset, address _pToken);
    event PTokenUpdated(address indexed _bAsset, address _pToken);

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);

    constructor(address _platformAddress)
        internal
    {
        require(_platformAddress != address(0), "Platform address zero");
        platformAddress = _platformAddress;
    }

    /***************************************
                    CONFIG
    ****************************************/

    function setPTokenAddress(address _bAsset, address _pToken)
        external
        onlyWhitelistAdmin
    {
        require(bAssetToPToken[_bAsset] == address(0), "pToken already set");
        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenAdded(_bAsset, _pToken);

        _abstractUpdatePToken(_bAsset, _pToken);
    }

    function _abstractUpdatePToken(address _bAsset, address _pToken) internal;

    // function reApproveAllTokens(address _bAsset, address _pToken) external onlyWhitelistedAdmin;

    function updatePTokenAddress(address _bAsset, address _pToken)
        external
        onlyWhitelistAdmin
    {
        require(bAssetToPToken[_bAsset] != address(0), "pToken not found");
        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenUpdated(_bAsset, _pToken);
    }

    /***************************************
                    ABSTRACT
    ****************************************/

    function deposit(address _spender, address _bAsset, uint256 _amount, bool isTokenFeeCharged)
        external returns (uint256 quantityDeposited);

    function withdraw(address _receiver, address _bAsset, uint256 _amount) external;

    function checkBalance(address _bAsset) external returns (uint256 balance);

    /***************************************
                    HELPERS
    ****************************************/

    function _min(uint256 x, uint256 y)
        internal
        pure
        returns (uint256)
    {
        return x > y ? y : x;
    }
}