pragma solidity ^0.5.16;

import { TokenController } from "minimetoken/contracts/TokenController.sol";
import { MiniMeToken } from "minimetoken/contracts/MiniMeToken.sol";
import { Module } from "../shared/Module.sol";

contract SystokController is Module, TokenController {

    MiniMeToken public systok;

    /** @dev Basic constructor to initialise ClaimableGovernance */
    constructor(
        address _nexus,
        address payable _systok
    )
        public
        Module(_nexus)
    {
        systok = MiniMeToken(_systok);
    }

    /***************************************
                MINIME MANAGEMENT
    ****************************************/

    /**
     * @dev Changes the controller of the contract
     * @param _newController The new controller of the contract
     */
    function changeController(address payable _newController)
        public
        onlyGovernor
    {
        systok.changeController(_newController);
    }


    /***************************************
                TOKEN CONTROLLER
    ****************************************/

    // Refer the function documentation in TokenController
    // Commented argument names to avoid compiler warnings
    function proxyPayment(address /*_owner*/)
        external
        payable
        returns(bool)
    {
        return false;
    }

    // Refer the function documentation in TokenController
    // Commented argument names to avoid compiler warnings
    function onTransfer(address /*_from*/, address /*_to*/, uint256 /*_amount*/)
        external
        returns (bool)
    {
        return true;
    }

    // Refer the function documentation in TokenController
    // Commented argument names to avoid compiler warnings
    function onApprove(address /*_owner*/, address /*_spender*/, uint /*_amount*/)
        external
        returns(bool)
    {
        return true;
    }
}