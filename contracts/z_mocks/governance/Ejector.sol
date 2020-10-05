pragma solidity 0.5.16;

import { IIncentivisedVotingLockup } from "../../interfaces/IIncentivisedVotingLockup.sol";

contract Ejector {

    IIncentivisedVotingLockup public votingLockup;

    constructor(IIncentivisedVotingLockup _votingLockup) public {
        votingLockup = _votingLockup;
    }

    function ejectMany(address[] calldata _users) external {
        uint count = _users.length;
        for(uint i = 0; i < count; i++){
            votingLockup.eject(_users[i]);
        }
    }

}