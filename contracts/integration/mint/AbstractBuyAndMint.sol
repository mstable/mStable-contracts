pragma solidity 0.5.16;

// Internal
import { IBuyAndMint } from "./IBuyAndMint.sol";
import { MassetHelpers } from "../../masset/shared/MassetHelpers.sol";

/**
 * @title   AbstractBuyAndMint
 * @author  Stability Labs Pty. Ltd.
 * @notice  Abstract contract to allow buy bAsset tokens with ETH and mint mAssets tokens
 *          from mStable.
 */
contract AbstractBuyAndMint is IBuyAndMint {
    using MassetHelpers for address;

    address[] public mAssets;

    constructor(address[] memory _mAssets) internal {
        require(_mAssets.length > 0, "No mAssets provided");
        mAssets = _mAssets;
    }

    /**
     * @dev Anyone can call and perform infinite approval for bAssets
     * @param _bAssets An array containing bAssets addresses
     */
    function infiniteApprove(address[] calldata _bAssets) external {
        for(uint256 i = 0; i < _bAssets.length; i++) {
            _bAssets[i].safeInfiniteApprove(_exteranlDexAddress());
        }
    }

    /**
     */
    function _isValidMasset(address _mAsset) internal returns (bool) {
        //TODO
    }

    /**
     */
    function _isValidBasset(address _mAsset, address _bAsset) internal returns (bool) {
        //TODO
    }

    /**
     * @dev Abstract function to get the external DEX contract address
     */
    function _exteranlDexAddress() internal returns(address);

    

}