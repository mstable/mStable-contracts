pragma solidity ^0.5.16;

import { TokenController } from "minimetoken/contracts/TokenController.sol";
import { MiniMeToken } from "minimetoken/contracts/MiniMeToken.sol";
import { Module } from "../shared/Module.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract MetaTokenController is Module, TokenController {

    using SafeMath for uint256;

    MiniMeToken public metaToken;

    uint256 public delay = 1 weeks;
    uint256 public requestTime;
    address payable public proposedController;

    /** @dev Basic constructor to initialise ClaimableGovernance */
    constructor(
        address _nexus,
        address payable _metaToken
    )
        public
        Module(_nexus)
    {
        metaToken = MiniMeToken(_metaToken);
    }

    modifier onlyMinter() {
        require(msg.sender == _governor() || msg.sender == _recollateraliser(), "Only minter can execute");
        _;
    }

    /***************************************
                MINIME MANAGEMENT
    ****************************************/

    /**
     * @dev Changes the controller of the contract
     * @param _newController The new controller of the contract
     */
    function proposeControllerChange(address payable _newController)
        external
        onlyGovernor
    {
        require(_newController != address(0), "Must propose valid controller");
        proposedController = _newController;
        requestTime = now;
    }

    /**
     * @notice Cancels an outstanding governor change request by resetting request time
     */
    function cancelControllerChange()
        external
        onlyGovernor
    {
        proposedController = address(0);
        requestTime = 0;
    }

    /**
     * @notice Proposed governor claims new position, callable after time elapsed
     */
    function confirmControllerChange()
        external
        onlyGovernor
    {
        require(now >= (requestTime.add(delay)), "Delay not over");
        metaToken.changeController(proposedController);
        proposedController = address(0);
        requestTime = 0;
    }


    /***************************************
                  OVERRIDES
    ****************************************/

    function generateTokens(address _owner, uint256 _amount)
        public
        onlyMinter
        returns (bool)
    {
        return metaToken.generateTokens(_owner, _amount);
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
