pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;

import { Manager, ISystok, IOracleHub, IGovernancePortal } from "../../manager/Manager.sol";

/**
 * @title ManagerMock so we can manipulate the storage for use in testing
 */
contract ManagerMock is Manager {

    constructor(
        IGovernancePortal _governor,
        address _nexus,
        ISystok _systok,
        IOracleHub _oracleHub,
        address _forgeLib
    )
        Manager(
            _governor,
            _nexus,
            _systok,
            _oracleHub,
            _forgeLib
        )
        public
    {

    }

    /**
      * @dev Override internal modifier on GetBassets
      */
    function getBassets_mock(address _masset)
    public
    view
    returns(address[] memory, bytes32[] memory) {
        return _getBassets(_masset);
    }

}


