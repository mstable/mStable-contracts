pragma solidity ^0.5.16;

import { TokenController } from "minimetoken/contracts/TokenController.sol";
import { MiniMeToken } from "minimetoken/contracts/MiniMeToken.sol";
import { Module } from "../shared/Module.sol";

contract SystokController is Module, TokenController {

    MiniMeToken public systok;

    /** @dev 1 week delayed upgrade period  */
    uint256 public constant UPGRADE_DELAY = 1 weeks;

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
     * @notice Changes the controller of the contract
     * @param _newController The new controller of the contract
     */
    function changeController(address payable _newController)
        public
        onlyGovernor {
        systok.changeController(_newController);
    }


    /***************************************
                TOKEN CONTROLLER
    ****************************************/

    /**
    * @dev Called when ether is sent to the MiniMe Token contract
    * @return True if the ether is accepted, false for it to throw
    */
    function proxyPayment(address _owner) external payable returns(bool) {
        return false;
    }

    /**
     * @dev Notifies the controller about a token transfer allowing the controller to decide whether
     *      to allow it or react if desired.
     * @param _from The origin of the transfer
     * @param _to The destination of the transfer
     * @param _amount The amount of the transfer
     * @return False if the controller does not authorize the transfer
     */
    function onTransfer(address _from, address _to, uint256 _amount) external returns (bool) {
        return true;
    }

    /**
    * @dev Notifies the controller about an approval allowing the controller to react if desired
    * @return False if the controller does not authorize the approval
    */
    function onApprove(address _owner, address _spender, uint _amount) external
        returns(bool)
    {
        return true;
    }

}