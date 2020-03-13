pragma solidity ^0.5.16;

import { IPlatform } from "./IPlatform.sol";
import { GovernableWhitelist } from "../../governance/GovernableWhitelist.sol";
import { Module } from "../../shared/Module.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { SafeERC20 } from "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";


contract AbstractPlatform is IPlatform, GovernableWhitelist, Initializable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public platformAddress;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public bAssetToPToken;

    event PTokenAdded(address indexed _bAsset, address _pToken);
    event PTokenUpdated(address indexed _bAsset, address _pToken);

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
    ) public initializer {
        Module._initialize(_nexus);
        GovernableWhitelist._initialize(_whitelisted);
        AbstractPlatform._initialize(_platformAddress);
    }

    /**
     * @dev Initialize function for upgradable proxy contract
     */
    function _initialize(address _platformAddress) internal {
        require(_platformAddress != address(0), "Platform address zero");
        platformAddress = _platformAddress;
    }

    function setPTokenAddress(address _bAsset, address _pToken) external onlyGovernor {
        require(bAssetToPToken[_bAsset] == address(0), "pToken already set");
        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenAdded(_bAsset, _pToken);
    }

    function updatePTokenAddress(address _bAsset, address _pToken) external onlyGovernor {
        require(bAssetToPToken[_bAsset] != address(0), "pToken not found");
        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenUpdated(_bAsset, _pToken);
    }
}