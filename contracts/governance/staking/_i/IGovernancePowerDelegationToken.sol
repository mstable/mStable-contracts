// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IGovernancePowerDelegationToken {
    enum DelegationType {
        VOTING_POWER,
        PROPOSITION_POWER
    }

    /**
     * @dev emitted when a user delegates to another
     * @param delegator the delegator
     * @param delegatee the delegatee
     * @param delegationType the type of delegation (VOTING_POWER, PROPOSITION_POWER)
     **/
    event DelegateChanged(
        address indexed delegator,
        address indexed delegatee,
        DelegationType delegationType
    );

    /**
     * @dev emitted when an action changes the delegated power of a user
     * @param user the user which delegated power has changed
     * @param amount the amount of delegated power for the user
     * @param delegationType the type of delegation (VOTING_POWER, PROPOSITION_POWER)
     **/
    event DelegatedPowerChanged(
        address indexed user,
        uint256 amount,
        DelegationType delegationType
    );

    /**
     * @dev delegates the specific power to a delegatee
     * @param delegatee the user which delegated power has changed
     * @param delegationType the type of delegation (VOTING_POWER, PROPOSITION_POWER)
     **/
    function delegateByType(address delegatee, DelegationType delegationType) external virtual;

    /**
     * @dev delegates all the powers to a specific user
     * @param delegatee the user to which the power will be delegated
     **/
    function delegate(address delegatee) external virtual;

    /**
     * @dev returns the delegatee of an user
     * @param delegator the address of the delegator
     **/
    function getDelegateeByType(address delegator, DelegationType delegationType)
        external
        view
        virtual
        returns (address);

    /**
     * @dev returns the current delegated power of a user. The current power is the
     * power delegated at the time of the last snapshot
     * @param user the user
     **/
    function getPowerCurrent(address user, DelegationType delegationType)
        external
        view
        virtual
        returns (uint256);

    /**
     * @dev returns the delegated power of a user at a certain block
     * @param user the user
     **/
    function getPowerAtBlock(
        address user,
        uint256 blockNumber,
        DelegationType delegationType
    ) external view virtual returns (uint256);

    /**
     * @dev returns the total supply at a certain block number
     **/
    function totalSupplyAt(uint256 blockNumber) external view virtual returns (uint256);
}
