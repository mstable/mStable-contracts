// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

// Internal
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IIncentivisedVotingLockup } from "../interfaces/IIncentivisedVotingLockup.sol";
import { IBoostedVaultWithLockup } from "../interfaces/IBoostedVaultWithLockup.sol";
import { IBoostDirector } from "../interfaces/IBoostDirector.sol";
import { ImmutableModule } from "../shared/ImmutableModule.sol";

/**
 * @title  BoostDirectorV2
 * @author mStable
 * @notice Supports the directing of balance from multiple StakedToken contracts up to X accounts
 * @dev    Uses a bitmap to store the id's of a given users chosen vaults in a gas efficient manner.
 */
contract BoostDirectorV2 is IBoostDirector, ImmutableModule {
    event Directed(address user, address boosted);
    event RedirectedBoost(address user, address boosted, address replaced);
    event Whitelisted(address vaultAddress, uint8 vaultId);

    event StakedTokenAdded(address token);
    event StakedTokenRemoved(address token);

    event BalanceDivisorChanged(uint256 newDivisor);

    // Read the vMTA balance from here
    IERC20[] public stakedTokenContracts;

    // Whitelisted vaults set by governance (only these vaults can read balances)
    uint8 private vaultCount;
    // Vault address -> internal id for tracking
    mapping(address => uint8) public _vaults;
    // uint128 packed with up to 16 uint8's. Each uint is a vault ID
    mapping(address => uint128) public _directedBitmap;
    // Divisor for voting powers to make more reasonable in vault
    uint256 private balanceDivisor;

    /***************************************
                    ADMIN
    ****************************************/

    // Simple constructor
    constructor(address _nexus) ImmutableModule(_nexus) {
        balanceDivisor = 12;
    }

    /**
     * @dev Initialize function - simply sets the initial array of whitelisted vaults
     */
    function initialize(address[] calldata _newVaults) external {
        require(vaultCount == 0, "Already initialized");
        _whitelistVaults(_newVaults);
    }

    /**
     * @dev Adds a staked token to the list, if it does not yet exist
     */
    function addStakedToken(address _stakedToken) external onlyGovernor {
        uint256 len = stakedTokenContracts.length;
        for (uint256 i = 0; i < len; i++) {
            require(address(stakedTokenContracts[i]) != _stakedToken, "StakedToken already added");
        }
        stakedTokenContracts.push(IERC20(_stakedToken));

        emit StakedTokenAdded(_stakedToken);
    }

    /**
     * @dev Removes a staked token from the list
     */
    function removeStakedToken(address _stakedToken) external onlyGovernor {
        uint256 len = stakedTokenContracts.length;
        for (uint256 i = 0; i < len; i++) {
            // If we find it, then swap it with the last element and delete the end
            if (address(stakedTokenContracts[i]) == _stakedToken) {
                stakedTokenContracts[i] = stakedTokenContracts[len - 1];
                stakedTokenContracts.pop();
                emit StakedTokenRemoved(_stakedToken);
                return;
            }
        }
    }

    /**
     * @dev Sets the divisor, by which all balances will be scaled down
     */
    function setBalanceDivisor(uint256 _newDivisor) external onlyGovernor {
        require(_newDivisor != balanceDivisor, "No change in divisor");
        require(_newDivisor < 15, "Divisor too large");

        balanceDivisor = _newDivisor;

        emit BalanceDivisorChanged(_newDivisor);
    }

    /**
     * @dev Whitelist vaults - only callable by governance. Whitelists vaults, unless they
     * have already been whitelisted
     */
    function whitelistVaults(address[] calldata _newVaults) external override onlyGovernor {
        _whitelistVaults(_newVaults);
    }

    /**
     * @dev Takes an array of newVaults. For each, determines if it is already whitelisted.
     * If not, then increment vaultCount and same the vault with new ID
     */
    function _whitelistVaults(address[] calldata _newVaults) internal {
        uint256 len = _newVaults.length;
        require(len > 0, "Must be at least one vault");
        for (uint256 i = 0; i < len; i++) {
            uint8 id = _vaults[_newVaults[i]];
            require(id == 0, "Vault already whitelisted");

            vaultCount += 1;
            _vaults[_newVaults[i]] = vaultCount;

            emit Whitelisted(_newVaults[i], vaultCount);
        }
    }

    /***************************************
                      Vault
    ****************************************/

    /**
     * @dev Gets the balance of a user that has been directed to the caller (a vault).
     * If the user has not directed to this vault, or there are less than 6 directed,
     * then add this to the list
     * @param _user     Address of the user for which to get balance
     * @return bal      Directed balance
     */
    function getBalance(address _user) external override returns (uint256 bal) {
        // Get vault details
        uint8 id = _vaults[msg.sender];
        // If vault has not been whitelisted, just return zero
        if (id == 0) return 0;

        // Get existing bitmap and balance
        uint128 bitmap = _directedBitmap[_user];
        uint256 len = stakedTokenContracts.length;
        for (uint256 i = 0; i < len; i++) {
            bal += stakedTokenContracts[i].balanceOf(_user);
        }

        bal /= balanceDivisor;

        (bool isWhitelisted, uint8 count, ) = _indexExists(bitmap, id);

        if (isWhitelisted) return bal;

        if (count < 6) {
            _directedBitmap[_user] = _direct(bitmap, count, id);
            emit Directed(_user, msg.sender);
            return bal;
        }

        if (count >= 6) return 0;
    }

    /**
     * @dev Directs rewards to a vault, and removes them from the old vault. Provided
     * that old is active and the new vault is whitelisted.
     * @param _old     Address of the old vault that will no longer get boosted
     * @param _new     Address of the new vault that will get boosted
     * @param _pokeNew Bool to say if we should poke the boost on the new vault
     */
    function setDirection(
        address _old,
        address _new,
        bool _pokeNew
    ) external override {
        uint8 idOld = _vaults[_old];
        uint8 idNew = _vaults[_new];

        require(idOld > 0 && idNew > 0, "Vaults not whitelisted");

        uint128 bitmap = _directedBitmap[msg.sender];
        (bool isWhitelisted, uint8 count, uint8 pos) = _indexExists(bitmap, idOld);
        require(isWhitelisted && count >= 6, "No need to replace old");

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
    ) internal pure returns (uint128 newMap) {
        // bitmap          = ... 00000000 00000000 00000011 00001010
        // pos = 1, id = 1 = 00000001
        // step            = ... 00000000 00000000 00000001 00000000
        uint8 id;
        uint128 step;
        for (uint8 i = 0; i < 6; i++) {
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
        pure
        returns (
            bool isWhitelisted,
            uint8 count,
            uint8 pos
        )
    {
        // bitmap   = ... 00000000 00000000 00000011 00001010 // positions 1 and 2 have ids 10 and 6 respectively
        // e.g.
        // i = 1: bitmap moves 8 bits to the right
        // bitmap   = ... 00000000 00000000 00000000 00000011 // reading uint8 should return 6
        uint8 id;
        for (uint8 i = 0; i < 6; i++) {
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
