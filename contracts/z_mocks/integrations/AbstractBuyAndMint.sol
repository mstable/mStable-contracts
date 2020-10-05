pragma solidity 0.5.16;

// Internal
import { MassetHelpers } from "../../masset/shared/MassetHelpers.sol";

// Library
import { Ownable } from "@openzeppelin/contracts/ownership/Ownable.sol";

/**
 * @title   AbstractBuyAndMint
 * @author  Stability Labs Pty. Ltd.
 * @notice  Abstract contract to allow buy bAsset tokens with ETH and mint mAssets tokens
 *          from mStable.
 */
contract AbstractBuyAndMint is Ownable {

    using MassetHelpers for address;

    event MassetAdded(address indexed mAsset);

    // mAsset address => exists
    mapping(address => bool) public mAssets;

    /**
     * @dev Abstarct constructor
     * @param _mAssets Array of valid mAsset addresses allowed to mint.
     */
    constructor(address[] memory _mAssets) internal {
        require(_mAssets.length > 0, "No mAssets provided");
        for(uint256 i = 0; i < _mAssets.length; i++) {
            _addMasset(_mAssets[i]);
        }
    }

    /**
     * @dev Anyone can call and perform infinite approval for bAssets
     * @param _bAssets An array containing bAssets addresses
     */
    function infiniteApprove(address _mAsset, address[] calldata _bAssets) external {
        for(uint256 i = 0; i < _bAssets.length; i++) {
            _bAssets[i].safeInfiniteApprove(_mAsset);
        }
    }

    /**
     * @dev The Owner of the contract allowed to add a new supported mAsset.
     * @param _mAsset Address of the mAsset
     */
    function addMasset(address _mAsset) external onlyOwner {
        _addMasset(_mAsset);
    }

    /**
     * @dev Add a new mAsset to the supported mAssets list
     * @param _mAsset Address of the mAsset
     */
    function _addMasset(address _mAsset) internal {
        require(_mAsset != address(0), "mAsset address is zero");
        require(!_massetExists(_mAsset), "mAsset already exists");
        mAssets[_mAsset] = true;
        emit MassetAdded(_mAsset);
    }

    /**
     * @dev     Validate that the given mAsset supported by this contract.
     * @notice  Only validate mAsset address. As bAsset gets validated during minting process.
     * @param _mAsset mAsset address to validate
     */
    function _massetExists(address _mAsset) internal view returns (bool) {
        return mAssets[_mAsset];
    }

    /**
     * @dev Abstract function to get the external DEX contract address
     */
    function _externalDexAddress() internal view returns(address);
}