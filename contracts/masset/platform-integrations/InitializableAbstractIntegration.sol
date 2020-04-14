pragma solidity 0.5.16;

// Internal
import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";
import { InitializableGovernableWhitelist } from "../../governance/InitializableGovernableWhitelist.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";

// Libs
import { MassetHelpers } from "../shared/MassetHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { InitializableReentrancyGuard } from "../../shared/InitializableReentrancyGuard.sol";

/**
 * @title   AbstractIntegration
 * @author  Stability Labs Pty. Ltd.
 * @notice  A generalised platform integration contract from which to inherit
 * @dev     Contains functionality for managing access to a specific lending
 *          platform. pTokens are the generic name given to platform tokens e.g. cDai
 *          Governance are responsible for setting platform and pToken addresses.
 */
contract InitializableAbstractIntegration is
    Initializable,
    IPlatformIntegration,
    InitializableGovernableWhitelist,
    InitializableReentrancyGuard
{

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event PTokenAdded(address indexed _bAsset, address _pToken);

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);

    // Core address for the given platform */
    address public platformAddress;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public bAssetToPToken;
    // Full list of all bAssets supported here
    address[] internal bAssetsMapped;

    /**
     * @dev Initialization function for upgradable proxy contract.
     *      This function should be called via Proxy just after contract deployment.
     * @param _nexus            Address of the Nexus
     * @param _whitelisted      Whitelisted addresses for vault access
     * @param _platformAddress  Generic platform address
     * @param _bAssets          Addresses of initial supported bAssets
     * @param _pTokens          Platform Token corresponding addresses
     */
    function initialize(
        address _nexus,
        address[] calldata _whitelisted,
        address _platformAddress,
        address[] calldata _bAssets,
        address[] calldata _pTokens
    )
        external
        initializer
    {
        InitializableReentrancyGuard._initialize();
        InitializableGovernableWhitelist._initialize(_nexus, _whitelisted);
        InitializableAbstractIntegration._initialize(_platformAddress, _bAssets, _pTokens);
    }

    /**
     * @dev Internal initialize function, to set up initial internal state
     * @param _platformAddress  Generic platform address
     * @param _bAssets          Addresses of initial supported bAssets
     * @param _pTokens          Platform Token corresponding addresses
     */
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

    /**
     * @dev Provide support for bAsset by passing its pToken address.
     * This method can only be called by the system Governor
     * @param _bAsset   Address for the bAsset
     * @param _pToken   Address for the corresponding platform token
     */
    function setPTokenAddress(address _bAsset, address _pToken)
        external
        onlyGovernor
    {
        _setPTokenAddress(_bAsset, _pToken);
    }

    /**
     * @dev Provide support for bAsset by passing its pToken address.
     * Add to internal mappings and execute the platform specific,
     * abstract method `_abstractSetPToken`
     * @param _bAsset   Address for the bAsset
     * @param _pToken   Address for the corresponding platform token
     */
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

    function reApproveAllTokens() external;

    /***************************************
                    ABSTRACT
    ****************************************/

    /**
     * @dev Deposit a quantity of bAsset into the platform
     * @param _bAsset              Address for the bAsset
     * @param _amount              Units of bAsset to deposit
     * @param _isTokenFeeCharged   Flag that signals if an xfer fee is charged on bAsset
     * @return quantityDeposited   Quantity of bAsset that entered the platform
     */
    function deposit(address _bAsset, uint256 _amount, bool _isTokenFeeCharged)
        external returns (uint256 quantityDeposited);

    /**
     * @dev Withdraw a quantity of bAsset from the platform
     * @param _receiver          Address to which the bAsset should be sent
     * @param _bAsset            Address of the bAsset
     * @param _amount            Units of bAsset to withdraw
     * @param _isTokenFeeCharged Flag that signals if an xfer fee is charged on bAsset
     */
    function withdraw(address _receiver, address _bAsset, uint256 _amount, bool _isTokenFeeCharged) external;

    /**
     * @dev Get the total bAsset value held in the platform
     * This includes any interest that was generated since depositing
     * @param _bAsset     Address of the bAsset
     * @return balance    Total value of the bAsset in the platform
     */
    function checkBalance(address _bAsset) external returns (uint256 balance);

    /***************************************
                    HELPERS
    ****************************************/

    /**
     * @dev Simple helper func to get the min of two values
     */
    function _min(uint256 x, uint256 y)
        internal
        pure
        returns (uint256)
    {
        return x > y ? y : x;
    }
}