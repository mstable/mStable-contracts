pragma solidity 0.5.16;

// Internal
import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";
import { GovernableWhitelist } from "../../governance/GovernableWhitelist.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

// Libs
import { MassetHelpers } from "../shared/MassetHelpers.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract AbstractIntegration is Initializable, IPlatformIntegration, GovernableWhitelist {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event PTokenAdded(address indexed _bAsset, address _pToken);
    event PTokenUpdated(address indexed _bAsset, address _pToken);

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);

    string public version = "1.0";

    address public platformAddress;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public bAssetToPToken;
    address[] internal bAssetsMapped;

    constructor(
        address _proxyAdmin,
        address _nexus,
        address[] memory _whitelisted,
        address _platformAddress,
        address[] memory _bAssets,
        address[] memory _pTokens
    )
        internal
        GovernableWhitelist(_proxyAdmin, _nexus, _whitelisted)
    {
        AbstractIntegration._initialize(_platformAddress, _bAssets, _pTokens);
    }

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     */
    function initialize(
        address _proxyAdmin,
        address _nexus,
        address[] memory _whitelisted,
        address _platformAddress,
        address[] memory _bAssets,
        address[] memory _pTokens
    )
        public
        initializer
    {
        GovernableWhitelist._initialize(_proxyAdmin, _nexus, _whitelisted);
        AbstractIntegration._initialize(_platformAddress, _bAssets, _pTokens);
        version = "1.0";
    }

    function _initialize(
        address _platformAddress,
        address[] memory _bAssets,
        address[] memory _pTokens
    )
        internal
    {
        platformAddress = _platformAddress;

        uint256 bAssetCount = _bAssets.length;
        require(bAssetCount == _pTokens.length, "Invalid input arrays");
        for(uint256 i = 0; i < bAssetCount; i++){
            _setPTokenAddress(_bAssets[i], _pTokens[i]);
        }
    }

    /***************************************
                    CONFIG
    ****************************************/

    function setPTokenAddress(address _bAsset, address _pToken)
        external
        onlyGovernor
    {
        _setPTokenAddress(_bAsset, _pToken);
    }

    function _setPTokenAddress(address _bAsset, address _pToken)
        internal
    {
        require(bAssetToPToken[_bAsset] == address(0), "pToken already set");
        require(_bAsset != address(0) && _pToken != address(0), "Invalid addresses");

        bAssetToPToken[_bAsset] = _pToken;
        bAssetsMapped.push(_bAsset);

        emit PTokenAdded(_bAsset, _pToken);

        _abstractSetPToken(_bAsset, _pToken);
    }

    function _abstractSetPToken(address _bAsset, address _pToken) internal;

    function updatePTokenAddress(address _bAsset, address _pToken)
        external
        onlyGovernor
    {
        address oldPToken = bAssetToPToken[_bAsset];
        require(oldPToken != address(0), "pToken not found");
        require(_bAsset != address(0) && _pToken != address(0), "Invalid addresses");

        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenUpdated(_bAsset, _pToken);

        _abstractUpdatePToken(_bAsset, oldPToken, _pToken);
    }

    function _abstractUpdatePToken(address _bAsset, address _oldPToken, address _pToken) internal;

    function reApproveAllTokens() external;

    /***************************************
                    ABSTRACT
    ****************************************/

    function deposit(address _bAsset, uint256 _amount, bool _isTokenFeeCharged)
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