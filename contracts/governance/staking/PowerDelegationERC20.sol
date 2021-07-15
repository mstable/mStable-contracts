// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { InitializableToken } from "../../shared/InitializableToken.sol";
import { IGovernancePowerDelegationToken } from "./_i/IGovernancePowerDelegationToken.sol";

/**
 * @notice implementation of the AAVE token contract
 * @author Aave
 */
abstract contract PowerDelegationERC20 is InitializableToken, IGovernancePowerDelegationToken {
    /// @notice The EIP-712 typehash for the delegation struct used by the contract
    bytes32 public constant DELEGATE_BY_TYPE_TYPEHASH =
        keccak256("DelegateByType(address delegatee,uint256 type,uint256 nonce,uint256 expiry)");

    bytes32 public constant DELEGATE_TYPEHASH =
        keccak256("Delegate(address delegatee,uint256 nonce,uint256 expiry)");

    /// @dev snapshot of a value on a specific block, used for votes
    struct Snapshot {
        uint128 blockNumber;
        uint128 value;
    }

    mapping(address => mapping(uint256 => Snapshot)) public _votingSnapshots;
    mapping(address => uint256) public _votingSnapshotsCounts;
    mapping(address => address) internal _votingDelegates;

    /**
     * @dev Initialization function for implementing contract
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function _initialize(string memory _nameArg, string memory _symbolArg)
        internal
        virtual
        override
    {
        super._initialize(_nameArg, _symbolArg);
    }

    /**
     * @dev delegates one specific power to a delegatee
     * @param delegatee the user which delegated power has changed
     * @param delegationType the type of delegation (VOTING_POWER, PROPOSITION_POWER)
     **/
    function delegateByType(address delegatee, DelegationType delegationType) external override {
        _delegateByType(msg.sender, delegatee, delegationType);
    }

    /**
     * @dev delegates all the powers to a specific user
     * @param delegatee the user to which the power will be delegated
     **/
    function delegate(address delegatee) external override {
        _delegateByType(msg.sender, delegatee, DelegationType.VOTING_POWER);
        _delegateByType(msg.sender, delegatee, DelegationType.PROPOSITION_POWER);
    }

    /**
     * @dev returns the delegatee of an user
     * @param delegator the address of the delegator
     **/
    function getDelegateeByType(address delegator, DelegationType delegationType)
        external
        view
        override
        returns (address)
    {
        (, , mapping(address => address) storage delegates) = _getDelegationDataByType(
            delegationType
        );

        return _getDelegatee(delegator, delegates);
    }

    /**
     * @dev returns the current delegated power of a user. The current power is the
     * power delegated at the time of the last snapshot
     * @param user the user
     **/
    function getPowerCurrent(address user, DelegationType delegationType)
        external
        view
        override
        returns (uint256)
    {
        (
            mapping(address => mapping(uint256 => Snapshot)) storage snapshots,
            mapping(address => uint256) storage snapshotsCounts,

        ) = _getDelegationDataByType(delegationType);

        return _searchByBlockNumber(snapshots, snapshotsCounts, user, block.number);
    }

    /**
     * @dev returns the delegated power of a user at a certain block
     * @param user the user
     **/
    function getPowerAtBlock(
        address user,
        uint256 blockNumber,
        DelegationType delegationType
    ) external view override returns (uint256) {
        (
            mapping(address => mapping(uint256 => Snapshot)) storage snapshots,
            mapping(address => uint256) storage snapshotsCounts,

        ) = _getDelegationDataByType(delegationType);

        return _searchByBlockNumber(snapshots, snapshotsCounts, user, blockNumber);
    }

    /**
     * @dev returns the total supply at a certain block number
     * used by the voting strategy contracts to calculate the total votes needed for threshold/quorum
     * In this initial implementation with no AAVE minting, simply returns the current supply
     * A snapshots mapping will need to be added in case a mint function is added to the AAVE token in the future
     **/
    function totalSupplyAt(uint256 blockNumber) external view override returns (uint256) {
        return super.totalSupply();
    }

    /**
     * @dev delegates the specific power to a delegatee
     * @param delegatee the user which delegated power has changed
     * @param delegationType the type of delegation (VOTING_POWER, PROPOSITION_POWER)
     **/
    function _delegateByType(
        address delegator,
        address delegatee,
        DelegationType delegationType
    ) internal {
        require(delegatee != address(0), "INVALID_DELEGATEE");

        (, , mapping(address => address) storage delegates) = _getDelegationDataByType(
            delegationType
        );

        uint256 delegatorBalance = balanceOf(delegator);

        address previousDelegatee = _getDelegatee(delegator, delegates);

        delegates[delegator] = delegatee;

        _moveDelegatesByType(previousDelegatee, delegatee, delegatorBalance, delegationType);
        emit DelegateChanged(delegator, delegatee, delegationType);
    }

    /**
     * @dev moves delegated power from one user to another
     * @param from the user from which delegated power is moved
     * @param to the user that will receive the delegated power
     * @param amount the amount of delegated power to be moved
     * @param delegationType the type of delegation (VOTING_POWER, PROPOSITION_POWER)
     **/
    function _moveDelegatesByType(
        address from,
        address to,
        uint256 amount,
        DelegationType delegationType
    ) internal {
        if (from == to) {
            return;
        }

        (
            mapping(address => mapping(uint256 => Snapshot)) storage snapshots,
            mapping(address => uint256) storage snapshotsCounts,

        ) = _getDelegationDataByType(delegationType);

        if (from != address(0)) {
            uint256 previous = 0;
            uint256 fromSnapshotsCount = snapshotsCounts[from];

            if (fromSnapshotsCount != 0) {
                previous = snapshots[from][fromSnapshotsCount - 1].value;
            } else {
                previous = balanceOf(from);
            }

            _writeSnapshot(
                snapshots,
                snapshotsCounts,
                from,
                uint128(previous),
                uint128(previous - amount)
            );

            emit DelegatedPowerChanged(from, previous - amount, delegationType);
        }
        if (to != address(0)) {
            uint256 previous = 0;
            uint256 toSnapshotsCount = snapshotsCounts[to];
            if (toSnapshotsCount != 0) {
                previous = snapshots[to][toSnapshotsCount - 1].value;
            } else {
                previous = balanceOf(to);
            }

            _writeSnapshot(
                snapshots,
                snapshotsCounts,
                to,
                uint128(previous),
                uint128(previous + amount)
            );

            emit DelegatedPowerChanged(to, previous + amount, delegationType);
        }
    }

    /**
     * @dev searches a snapshot by block number. Uses binary search.
     * @param snapshots the snapshots mapping
     * @param snapshotsCounts the number of snapshots
     * @param user the user for which the snapshot is being searched
     * @param blockNumber the block number being searched
     **/
    function _searchByBlockNumber(
        mapping(address => mapping(uint256 => Snapshot)) storage snapshots,
        mapping(address => uint256) storage snapshotsCounts,
        address user,
        uint256 blockNumber
    ) internal view returns (uint256) {
        require(blockNumber <= block.number, "INVALID_BLOCK_NUMBER");

        uint256 snapshotsCount = snapshotsCounts[user];

        if (snapshotsCount == 0) {
            return balanceOf(user);
        }

        // First check most recent balance
        if (snapshots[user][snapshotsCount - 1].blockNumber <= blockNumber) {
            return snapshots[user][snapshotsCount - 1].value;
        }

        // Next check implicit zero balance
        if (snapshots[user][0].blockNumber > blockNumber) {
            return 0;
        }

        uint256 lower = 0;
        uint256 upper = snapshotsCount - 1;
        while (upper > lower) {
            uint256 center = upper - (upper - lower) / 2; // ceil, avoiding overflow
            Snapshot memory snapshot = snapshots[user][center];
            if (snapshot.blockNumber == blockNumber) {
                return snapshot.value;
            } else if (snapshot.blockNumber < blockNumber) {
                lower = center;
            } else {
                upper = center - 1;
            }
        }
        return snapshots[user][lower].value;
    }

    /**
     * @dev returns the delegation data (snapshot, snapshotsCount, list of delegates) by delegation type
     * NOTE: Ideal implementation would have mapped this in a struct by delegation type. Unfortunately,
     * the AAVE token and StakeToken already include a mapping for the snapshots, so we require contracts
     * who inherit from this to provide access to the delegation data by overriding this method.
     * @param delegationType the type of delegation
     **/
    function _getDelegationDataByType(DelegationType delegationType)
        internal
        view
        virtual
        returns (
            mapping(address => mapping(uint256 => Snapshot)) storage, //snapshots
            mapping(address => uint256) storage, //snapshots count
            mapping(address => address) storage //delegatees list
        );

    /**
     * @dev Writes a snapshot for an owner of tokens
     * @param owner The owner of the tokens
     * @param oldValue The value before the operation that is gonna be executed after the snapshot
     * @param newValue The value after the operation
     */
    function _writeSnapshot(
        mapping(address => mapping(uint256 => Snapshot)) storage snapshots,
        mapping(address => uint256) storage snapshotsCounts,
        address owner,
        uint128 oldValue,
        uint128 newValue
    ) internal {
        uint128 currentBlock = uint128(block.number);

        uint256 ownerSnapshotsCount = snapshotsCounts[owner];
        mapping(uint256 => Snapshot) storage snapshotsOwner = snapshots[owner];

        // Doing multiple operations in the same block
        if (
            ownerSnapshotsCount != 0 &&
            snapshotsOwner[ownerSnapshotsCount - 1].blockNumber == currentBlock
        ) {
            snapshotsOwner[ownerSnapshotsCount - 1].value = newValue;
        } else {
            snapshotsOwner[ownerSnapshotsCount] = Snapshot(currentBlock, newValue);
            snapshotsCounts[owner] = ownerSnapshotsCount + 1;
        }
    }

    /**
     * @dev returns the user delegatee. If a user never performed any delegation,
     * his delegated address will be 0x0. In that case we simply return the user itself
     * @param delegator the address of the user for which return the delegatee
     * @param delegates the array of delegates for a particular type of delegation
     **/
    function _getDelegatee(address delegator, mapping(address => address) storage delegates)
        internal
        view
        returns (address)
    {
        address previousDelegatee = delegates[delegator];

        if (previousDelegatee == address(0)) {
            return delegator;
        }

        return previousDelegatee;
    }
}
