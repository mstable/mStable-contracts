pragma solidity ^0.5.12;

import { MetaToken } from "./MetaToken.sol";
import { ModuleSub } from "../shared/pubsub/ModuleSub.sol";

import { INexus } from "../interfaces/INexus.sol";
import { ISystok } from "../interfaces/ISystok.sol";
import { IRecollateraliser } from "../interfaces/IRecollateraliser.sol";

/**
 * @title Systok (System Token)
 * @author Stability Labs Pty Ltd.
 * @dev Implementation of Systok - the token used hroughout the mStable Standard;
 *      namely through governance, forging and re-collateralisation
 *
 * BURN/MINT PRIVS
 * Only self & Recollateraliser can mint new Meta
 * Anyone can burn and burnFrom Meta, provided they have the allowance
 */
contract Systok is ISystok, ModuleSub, MetaToken {

    /** @dev References to current system Module implementations */
    IRecollateraliser recollateraliser;


    /** @dev Events to emit */
    event ModuleUpdated(bytes32 indexed key, address newAddress);


    /** @dev Basic constructor to initialise the Systok */
    constructor(
        INexus _nexus,
        address _initialRecipient
    )
        public
        MetaToken(_initialRecipient)
        ModuleSub(address(_nexus))
    {
      
    }



    /**
      * @dev Internally handles updates to the system modules
      * @param _key         Module key
      * @param _newAddress  Address of the updated Module
      */
    function _internalUpdateModule(bytes32 _key, address _newAddress)
    internal {
        emit ModuleUpdated(_key, _newAddress);

        if (_key == Key_Recollateraliser) {
            address old = address(recollateraliser);
            // Remove privs from old recollateraliser
            if(old != address(0)) {
              _removeMinter(old);
            }
            recollateraliser = IRecollateraliser(_newAddress);
            // Allow new recollateraliser to mint new Meta for utility
            _addMinter(_newAddress);
        }
    }
}