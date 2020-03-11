pragma solidity 0.5.16;

import { MassetStructs } from "../masset/shared/MassetStructs.sol";

/**
 * @title IMasset
 * @dev (Internal) Interface for interacting with Masset
 */
contract IMasset is MassetStructs {

    /** @dev Calc interest */
    function collectInterest() external returns (uint256 massetMinted, uint256 newTotalSupply);

    /** @dev Minting */
    function mint(address _basset, uint256 _bassetQuantity) external returns (uint256 massetMinted);
    function mintTo(address _basset, uint256 _bassetQuantity, address _recipient) external returns (uint256 massetMinted);
    function mintMulti(uint32 _bassetsBitmap, uint256[] calldata _bassetQuantity, address _recipient) external returns (uint256 massetMinted);

    /** @dev Redeeming */
    function redeem(address _basset,uint256 _bassetQuantity) external returns (uint256 massetRedeemed);
    function redeemTo(address _basset, uint256 _bassetQuantity, address _recipient) external returns (uint256 massetRedeemed);
    function redeemMulti(uint32 _bassetsBitmap, uint256[] calldata _bassetQuantity, address _recipient)
        external returns (uint256 massetRedeemed);

    /** @dev Setters for the Manager or Gov to update module info */
    function upgradeForgeValidator(address _newForgeValidator) external;

    /** @dev Setters for Gov to set system params */
    function setRedemptionFee(uint256 _redemptionFee) external;
    function setFeeRecipient(address _feeRecipient) external;

    /** @dev Getters */
    function getBasketManager() external view returns(address);
}
