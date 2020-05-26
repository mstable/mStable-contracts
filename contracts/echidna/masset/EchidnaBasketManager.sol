pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { BasketManager } from "../../masset/BasketManager.sol";
import { MassetStructs } from "../../masset/shared/MassetStructs.sol";
import { BasketManager } from "../../masset/BasketManager.sol";
import { StableMath } from "../../shared/StableMath.sol";

// This script allows the direct setting of basket properties
contract EchidnaBasketManager is BasketManager { 
      function echidna_masset_address_not_zero() public returns (bool){
          return (_mAsset != address(0));
      }

      function echidna_basset_length_not_zero() public returns (bool){
          return (_bAssets.length > 0);
      }

      function echidna_basset_does_not_exceed_length() public returns (bool){
          return (basket.bassets.length < basket.maxBassets);
      }

      function echidna_bassets_avail_do_not_exceed_length() public returns (bool){
          return (length < basket.maxBassets);
      }

      function echidna_basket_not_failed() public returns (bool) {
          return (basket.failed);
      }

      function echidna_masset_is_sender() public returns (bool) {
          return (mAsset == msg.sender);
      }

      function echidna_basset_not_address_zero() public returns (bool){
          return (_bAssets != address(0));
      }

      function echidna_integration_not_address_zero() public returns (bool){
          return (_integration != address(0));
      }

      function echidna_validate_no_duplicates() public returns (bool) {
          bool duplicate = false;
          for(uint8 i = 0; i < len; i++) {
            address current = _bAssets[i];

            // If there is a duplicate here, throw
            // Gas costs do not incur SLOAD
            for(uint8 j = i+1; j < len; j++){
                if (current == _bAssets[j])
                {
                    duplicate = true;
                }
            }
      }
      return duplicate;
    }

    function echidna_basket_weight_does_not_exceed_limit() public returns (bool) {
        uint256 len = basket.bassets.length;
        uint256 weightSum = 0;
        for(uint256 i = 0; i < len; i++) {
            weightSum = weightSum.add(basket.bassets[i].maxWeight);
        }
        return (weightSum >= 1e18 && weightSum <= 2e18);
    }

}