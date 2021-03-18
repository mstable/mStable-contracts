pragma solidity 0.8.0;

// Internal
import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";

// Libs
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title   AbstractIntegration
 * @author  Stability Labs Pty. Ltd.
 * @notice  A generalised platform integration contract from which to inherit
 * @dev     Contains functionality for managing access to a specific lending
 *          platform. pTokens are the generic name given to platform tokens e.g. cDai
 *          Governance are responsible for setting platform and pToken addresses.
 */
abstract contract AbstractIntegration is
    IPlatformIntegration,
    ImmutableModule,
    ReentrancyGuard
{
    event PTokenAdded(address indexed _bAsset, address _pToken);

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);
    event PlatformWithdrawal(address indexed bAsset, address pToken, uint256 totalAmount, uint256 userAmount);

    // mAsset has write access
    address public immutable mAssetAddress;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public override bAssetToPToken;
    // Full list of all bAssets supported here
    address[] internal bAssetsMapped;

    /**
     * @param _nexus            Address of the Nexus
     * @param _mAsset           Address of mAsset
     */
    constructor(
        address _nexus,
        address _mAsset
    ) ReentrancyGuard() ImmutableModule(_nexus)  {
        require(_mAsset != address(0), "Invalid mAsset address");
        mAssetAddress = _mAsset;
    }

    /**
     * @dev Modifier to allow function calls only from the Governor.
     */
    modifier onlyMasset() {
        require(msg.sender == mAssetAddress, "Only the mAsset can execute");
        _;
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

    function _abstractSetPToken(address _bAsset, address _pToken) internal virtual;

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
