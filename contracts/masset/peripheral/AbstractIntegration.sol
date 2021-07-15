// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

import { IPlatformIntegration } from "../../interfaces/IPlatformIntegration.sol";
import { ImmutableModule } from "../../shared/ImmutableModule.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title   AbstractIntegration
 * @author  mStable
 * @notice  A generalised platform integration contract from which to inherit
 * @dev     Contains functionality for managing access to a specific lending
 *          platform. pTokens are the generic name given to platform tokens e.g. cDai
 *          Governance are responsible for setting platform and pToken addresses.
 */
abstract contract AbstractIntegration is
    IPlatformIntegration,
    Initializable,
    ImmutableModule,
    ReentrancyGuard
{
    event PTokenAdded(address indexed _bAsset, address _pToken);

    event Deposit(address indexed _bAsset, address _pToken, uint256 _amount);
    event Withdrawal(address indexed _bAsset, address _pToken, uint256 _amount);
    event PlatformWithdrawal(
        address indexed bAsset,
        address pToken,
        uint256 totalAmount,
        uint256 userAmount
    );

    /// @notice mAsset or Feeder Pool using the integration. eg fPmUSD/alUSD
    /// @dev LP has write access
    address public immutable lpAddress;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public bAssetToPToken;
    // Full list of all bAssets supported here
    address[] internal bAssetsMapped;

    /**
     * @param _nexus     Address of the Nexus
     * @param _lp        Address of LP
     */
    constructor(address _nexus, address _lp) ReentrancyGuard() ImmutableModule(_nexus) {
        require(_lp != address(0), "Invalid LP address");
        lpAddress = _lp;
    }

    /**
     * @dev Simple initializer to set first bAsset/pTokens
     */
    function initialize(address[] calldata _bAssets, address[] calldata _pTokens)
        public
        initializer
    {
        uint256 len = _bAssets.length;
        require(len == _pTokens.length, "Invalid inputs");
        for (uint256 i = 0; i < len; i++) {
            _setPTokenAddress(_bAssets[i], _pTokens[i]);
        }
    }

    /**
     * @dev Modifier to allow function calls only from the Governor.
     */
    modifier onlyLP() {
        require(msg.sender == lpAddress, "Only the LP can execute");
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
    function setPTokenAddress(address _bAsset, address _pToken) external onlyGovernor {
        _setPTokenAddress(_bAsset, _pToken);
    }

    /**
     * @dev Provide support for bAsset by passing its pToken address.
     * Add to internal mappings and execute the platform specific,
     * abstract method `_abstractSetPToken`
     * @param _bAsset   Address for the bAsset
     * @param _pToken   Address for the corresponding platform token
     */
    function _setPTokenAddress(address _bAsset, address _pToken) internal {
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
    function _min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x > y ? y : x;
    }
}
