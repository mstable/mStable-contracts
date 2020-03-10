pragma solidity ^0.5.16;

import { IPlatform } from "./IPlatform.sol";
import { WhitelistedRole } from "openzeppelin-solidity/contracts/access/roles/WhitelistedRole.sol";

contract AbstractPlatform is IPlatform, WhitelistedRole {

    address public platformAddress;

    // bAsset => pToken (Platform Specific Token Address)
    mapping(address => address) public bAssetToPToken;

    event PTokenAdded(address indexed _bAsset, address _pToken);
    event PTokenUpdated(address indexed _bAsset, address _pToken);

    constructor(address _platformAddress) internal {
        require(_platformAddress != address(0), "Platform address zero");
        platformAddress = _platformAddress;
    }

    function setPTokenAddress(address _bAsset, address _pToken) external onlyWhitelistAdmin {
        require(bAssetToPToken[_bAsset] == address(0), "pToken already set");
        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenAdded(_bAsset, _pToken);
    }

    function updatePTokenAddress(address _bAsset, address _pToken) external onlyWhitelistAdmin {
        require(bAssetToPToken[_bAsset] != address(0), "pToken not found");
        bAssetToPToken[_bAsset] = _pToken;
        emit PTokenUpdated(_bAsset, _pToken);
    }
}