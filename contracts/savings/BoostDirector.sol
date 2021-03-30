// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.2;

// Internal
import { IIncentivisedVotingLockup } from "../interfaces/IIncentivisedVotingLockup.sol";
import { IBoostedVaultWithLockup } from "../interfaces/IBoostedVaultWithLockup.sol";
import { IBoostDirector } from "../interfaces/IBoostDirector.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";


/**
 * @title  BoostDirector
 * @author mStable
 * @notice Supports the directing of vMTA balance from Staking up to X accounts
 * @dev    Uses a bitmap to store the id's of a given users chosen pools in a gas efficient manner.
 */
contract BoostDirector is IBoostDirector, ImmutableModule {

    event Directed(address user, address boosted);
    event RedirectedBoost(address user, address boosted, address replaced);
    event Whitelisted(address pool);

    // Read the vMTA balance from here
    IIncentivisedVotingLockup public immutable stakingContract;

    // Whitelisted pools set by governance (only these pools can read balances)
    uint8 private poolCount;
    // Pool address -> internal id for tracking
    mapping(address => uint8) public _pools;
    // uint128 packed with up to 16 uint8's. Each uint is a pool ID
    mapping(address => uint128) public _directedBitmap;


    /***************************************
                      ADMIN
    ****************************************/

    // Simple constructor
    constructor(address _nexus, address _stakingContract) ImmutableModule(_nexus) {
        stakingContract = IIncentivisedVotingLockup(_stakingContract);
    }

    /**
     * @dev Initialize function - simply sets the initial array of whitelisted pools
     */
    function initialize(address[] calldata _newPools) external {
        require(poolCount == 0, "Already initialized");
        _whitelistPools(_newPools);
    }

    /**
     * @dev Whitelist pools - only callable by governance. Whitelists pools, unless they
     * have already been whitelisted
     */
    function whitelistPools(address[] calldata _newPools) external override onlyGovernor {
        _whitelistPools(_newPools);
    }

    /**
     * @dev Takes an array of newPools. For each, determines if it is already whitelisted.
     * If not, then increment poolCount and same the pool with new ID
     */
    function _whitelistPools(address[] calldata _newPools) internal {
        uint256 len = _newPools.length;
        for (uint256 i = 0; i < len; i++) {
            uint8 id = _pools[_newPools[i]];
            require(id == 0, "Pool already whitelisted");

            poolCount += 1;
            _pools[_newPools[i]] = poolCount;

            emit Whitelisted(_newPools[i]);
        }
    }


    /***************************************
                      POOL
    ****************************************/

    // A view methods for getBalance.. necessary?
    // function readBalance(address _pool, address _user) external view returns (uint256) {
    // }

    /**
     * @dev Gets the balance of a user that has been directed to the caller (a pool).
     * If the user has not directed to this pool, or there are less than 3 directed,
     * then add this to the list
     * @param _user     Address of the user for which to get balance
     * @return Directed balance
     */
    function getBalance(address _user) external override returns (uint256) {
        // Get pool details
        uint8 id = _pools[msg.sender];
        if(id == 0) return 0;

        // Get existing bitmap and balance
        uint128 bitmap = _directedBitmap[_user];
        uint256 bal = stakingContract.balanceOf(_user);

        (bool isWhitelisted, uint8 count, ) = _indexExists(bitmap, id);

        if (isWhitelisted) return bal;

        if (count < 3) {
            _directedBitmap[_user] = _direct(bitmap, count, id);
            emit Directed(_user, msg.sender);
            return bal;
        }

        if (count >= 3) return 0;
    }

    /**
     * @dev Directs rewards to a pool, and removes them from the old pool. Provided
     * that old is active and the new pool is whitelisted.
     * @param _old     Address of the old pool that will no longer get boosted
     * @param _new     Address of the new pool that will get boosted
     * @param _pokeNew Bool to say if we should poke the boost on the new pool
     */
    function setDirection(
        address _old,
        address _new,
        bool _pokeNew
    ) external override {
        uint8 idOld = _pools[_old];
        uint8 idNew = _pools[_new];

        require(idOld > 0 && idNew > 0, "Pools not whitelisted");

        uint128 bitmap = _directedBitmap[msg.sender];
        (bool isWhitelisted, uint8 count, uint8 pos) = _indexExists(bitmap, idOld);
        require(isWhitelisted && count >= 3, "No need to replace old");

        _directedBitmap[msg.sender] = _direct(bitmap, pos, idNew);

        IBoostedVaultWithLockup(_old).pokeBoost(msg.sender);

        if (_pokeNew) {
            IBoostedVaultWithLockup(_new).pokeBoost(msg.sender);
        }

        emit RedirectedBoost(msg.sender, _new, _old);
    }

    /**
     * @dev Resets the bitmap given the new _id for _pos. Takes each uint8 in seperate and re-compiles
     */
    function _direct(
        uint128 _bitmap,
        uint8 _pos,
        uint8 _id
    ) internal returns (uint128 newMap) {
        // bitmap          = ... 00000000 00000000 00000011 00001010
        // pos = 1, id = 1 = 00000001
        // step            = ... 00000000 00000000 00000001 00000000
        uint8 id;
        uint128 step;
        for (uint8 i = 0; i < 3; i++) {
            unchecked {
                // id is either the one that is passed, or existing
                id = _pos == i ? _id : uint8(_bitmap >> (i * 8));
                step = uint128(uint128(id) << (i * 8));
            }
            newMap |= step;
        }
    }

    /**
     * @dev Given a 128 bit bitmap packed with 8 bit ids, should be able to filter for specific ids by moving
     * the bitmap gradually to the right and reading each 8 bit section as a uint8.
     */
    function _indexExists(uint128 _bitmap, uint8 _target)
        internal
        view
        returns (
            bool isWhitelisted,
            uint8 count,
            uint8 pos
        )
    {
        // bitmap   = ... 00000000 00000000 00000011 00001010 // positions 1 and 2 have ids 10 and 3 respectively
        // e.g.
        // i = 1: bitmap moves 8 bits to the right
        // bitmap   = ... 00000000 00000000 00000000 00000011 // reading uint8 should return 3
        uint8 id;
        for (uint8 i = 0; i < 3; i++) {
            unchecked {
                id = uint8(_bitmap >> (i * 8));
            }
            if (id > 0) count += 1;
            if (id == _target) {
                isWhitelisted = true;
                pos = i;
            }
        }
    }
}
