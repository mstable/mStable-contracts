pragma solidity ^0.5.12;

import { ModuleSub } from "../shared/pubsub/ModuleSub.sol";
import {
  ManagerState,
  IRecollateraliser,
  IGovernancePortal,
  ISystok,
  IOracleHub,
  IMasset
} from "./ManagerState.sol";

/**
 * @title ManagerModule
 * @dev Acts as a subscriber to the Nexus, which publishes each new Module that is introduced
 * to the system. If the module is relevant to the Manager, we will listen for it here and
 * update its reference, and those of the Massets too
 *
 *
 *
 * TODO: THOUGHTS: Maybe the Manager could also be the Nexus.. and thus the publisher.
 * If it were a proxy itself, it would be easily upgradable.
 * It's just not going to be replacable in it's current state as it requires state transfer
 */
contract ManagerModule is ModuleSub, ManagerState {

    /** @dev Events to emit */
    event ModuleUpdated(bytes32 indexed key, address newAddress);


    /**
      * @dev Initialises this Module by setting the publisher on ModuleSub
      * @param _pub Address of the Publisher (Nexus) module
      */
    constructor(address _pub) ModuleSub(_pub) public {}


    /**
      * @dev Internally handles updates to the system modules
      * @param _key         Module key
      * @param _newAddress  Address of the updated Module
      */
    function _internalUpdateModule(bytes32 _key, address _newAddress)
    internal {
        emit ModuleUpdated(_key, _newAddress);

        if (_key == Key_Governor) {
            governor = _newAddress;
        }

        if (_key == Key_GovernancePortal) {
            governance = IGovernancePortal(_newAddress);
        }

        if (_key == Key_Systok) {
            systok = ISystok(_newAddress);

            address[] memory massets = massets.keys;
            for(uint256 i = 0; i < massets.length; i++) {
                IMasset tempMasset = IMasset(massets[i]);
                tempMasset.setSystok(systok);
            }
        }

        if (_key == Key_OracleHub) {
            oracleHub = IOracleHub(_newAddress);
        }

        if (_key == Key_Recollateraliser) {
            recollateraliser = IRecollateraliser(_newAddress);
        }
    }
}