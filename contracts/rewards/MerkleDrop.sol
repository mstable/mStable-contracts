pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MerkleProof } from "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableGovernableWhitelist } from "../governance/InitializableGovernableWhitelist.sol";

contract MerkleDrop is Initializable, InitializableGovernableWhitelist {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event Claimed(address claimant, uint256 week, uint256 balance);
    event RemovedFundManager(address indexed _address);

    IERC20 public token;

    mapping(uint256 => bytes32) public merkleRoots;
    mapping(uint256 => mapping(address => bool)) public claimed;
    uint256 tranches;

    function initialize(
        address _nexus,
        address[] calldata _fundManagers,
        IERC20 _token
    )
        external
        initializer
    {
        InitializableGovernableWhitelist._initialize(_nexus, _fundManagers);
        token = _token;
    }

    /***************************************
                    ADMIN
    ****************************************/

    function seedNewAllocations(bytes32 _merkleRoot, uint256 _totalAllocation)
        public
        onlyWhitelisted
        returns (uint256 trancheId)
    {
        require(token.transferFrom(msg.sender, address(this), _totalAllocation), "Must receive token from sender");

        trancheId = tranches;
        merkleRoots[trancheId] = _merkleRoot;

        tranches = tranches.add(1);
    }

    // TODO - override or delete tranche

    /**
     * @dev Allows the mStable governance to add a new FundManager
     * @param _address  FundManager to add
     */
    function addFundManager(address _address)
        external
        onlyGovernor
    {
        _addWhitelist(_address);
    }

    /**
     * @dev Allows the mStable governance to remove inactive FundManagers
     * @param _address  FundManager to remove
     */
    function removeFundManager(address _address)
        external
        onlyGovernor
    {
        require(_address != address(0), "Address is zero");
        require(whitelist[_address], "Address is not whitelisted");

        whitelist[_address] = false;

        emit RemovedFundManager(_address);
    }


    /***************************************
                  CLAIMING
    ****************************************/


    function claimWeek(
        address _liquidityProvider,
        uint256 _tranche,
        uint256 _balance,
        bytes32[] memory _merkleProof
    )
        public
    {
        _claimWeek(_liquidityProvider, _tranche, _balance, _merkleProof);
        _disburse(_liquidityProvider, _balance);
    }


    function claimWeeks(
        address _liquidityProvider,
        uint256[] memory _tranches,
        uint256[] memory _balances,
        bytes32[][] memory _merkleProofs
    )
        public
    {
        uint256 len = _tranches.length;
        require(len == _balances.length && len == _merkleProofs.length, "");

        uint256 totalBalance = 0;
        for(uint256 i = 0; i < len; i++) {
            _claimWeek(_liquidityProvider, _tranches[i], _balances[i], _merkleProofs[i]);
            totalBalance = totalBalance.add(_balances[i]);
        }
        _disburse(_liquidityProvider, totalBalance);
    }

    function _claimWeek(
        address _liquidityProvider,
        uint256 _tranche,
        uint256 _balance,
        bytes32[] memory _merkleProof
    )
        private
    {
        require(_tranche < tranches, "Week cannot be in the future");

        require(!claimed[_tranche][_liquidityProvider], "LP has already claimed");
        require(_verifyClaim(_liquidityProvider, _tranche, _balance, _merkleProof), "Incorrect merkle proof");

        claimed[_tranche][_liquidityProvider] = true;

        emit Claimed(_liquidityProvider, _tranche, _balance);
    }

    function verifyClaim(
        address _liquidityProvider,
        uint256 _tranche,
        uint256 _balance,
        bytes32[] memory _merkleProof
    )
        public
        view
        returns (bool valid)
    {
        return _verifyClaim(_liquidityProvider, _tranche, _balance, _merkleProof);
    }

    function _verifyClaim(
        address _liquidityProvider,
        uint256 _tranche,
        uint256 _balance,
        bytes32[] memory _merkleProof
    )
        private
        view
        returns (bool valid)
    {
        bytes32 leaf = keccak256(abi.encodePacked(_liquidityProvider, _balance));
        return MerkleProof.verify(_merkleProof, merkleRoots[_tranche], leaf);
    }

    function _disburse(address _liquidityProvider, uint256 _balance) private {
        if (_balance > 0) {
            token.transfer(_liquidityProvider, _balance);
        } else {
            revert("No balance would be transfered - not gonna waste your gas");
        }
    }
}


    // function claimStatus(address _liquidityProvider, uint256 _begin, uint256 _end)
    //     view
    //     public
    //     returns (bool[] memory)
    // {
    //     uint256 size = 1 + _end - _begin;
    //     bool[] memory arr = new bool[](size);
    //     for(uint256 i = 0; i < size; i++) {
    //       arr[i] = claimed[_begin + i][_liquidityProvider];
    //     }
    //     return arr;
    // }

    // function merkleRoots(uint256 _begin, uint256 _end) view public returns (bytes32[] memory) {
    //     uint256 size = 1 + _end - _begin;
    //     bytes32[] memory arr = new bytes32[](size);
    //     for(uint256 i = 0; i < size; i++) {
    //       arr[i] = merkleRoots[_begin + i];
    //     }
    //     return arr;
    // }