pragma solidity 0.5.16;

// Internal
import { IPlatform } from "../../interfaces/IPlatform.sol";
import { GovernableWhitelist } from "../../governance/GovernableWhitelist.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

// Libs
import { MassetHelpers } from "../shared/MassetHelpers.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract AbstractPlatform is IPlatform, GovernableWhitelist, Initializable {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event PTokenAdded(address indexed _bAsset, address _pToken);
    event PTokenUpdated(address indexed _bAsset, address _pToken);

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);

    string public constant version = "1.0";

    address public platformAddress;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public bAssetToPToken;
    address[] internal bAssetsMapped;

    constructor(
        address _nexus,
        address[] memory _whitelisted,
        address _platformAddress
    )
        internal
        GovernableWhitelist(_nexus, _whitelisted)
    {
        AbstractPlatform._initialize(_platformAddress);
    }

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     */
    function initialize(
        address _nexus,
        address[] memory _whitelisted,
        address _platformAddress
    )
        public
        initializer
    {
        GovernableWhitelist._initialize(_nexus, _whitelisted);
        AbstractPlatform._initialize(_platformAddress);
    }

    /**
     * @dev Initialize function for upgradable proxy contract
     */
    function _initialize(address _platformAddress) internal {
        require(_platformAddress != address(0), "Platform address zero");
        platformAddress = _platformAddress;
    }

    /***************************************
                    CONFIG
    ****************************************/

    function setPTokenAddress(address _bAsset, address _pToken)
        external
        onlyGovernor
    {
        require(bAssetToPToken[_bAsset] == address(0), "pToken already set");

        bAssetToPToken[_bAsset] = _pToken;
        bAssetsMapped.push(_bAsset);

        emit PTokenAdded(_bAsset, _pToken);

        _abstractSetPToken(_bAsset, _pToken);
    }


    function updatePTokenAddress(address _bAsset, address _pToken)
        external
        onlyGovernor
    {
        address oldPToken = bAssetToPToken[_bAsset];
        require(oldPToken != address(0), "pToken not found");
        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenUpdated(_bAsset, _pToken);

        _abstractUpdatePToken(_bAsset, oldPToken, _pToken);
    }

    function _abstractSetPToken(address _bAsset, address _pToken) internal;
    function _abstractUpdatePToken(address _bAsset, address _oldPToken, address _pToken) internal;

    function reApproveAllTokens(address _bAsset, address _pToken) external;

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