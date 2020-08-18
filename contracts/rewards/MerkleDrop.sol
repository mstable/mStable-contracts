pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MerkleProof } from "@openzeppelin/contracts/cryptography/MerkleProof.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { InitializableGovernableWhitelist } from "../governance/InitializableGovernableWhitelist.sol";

contract MerkleDrop is InitializableGovernableWhitelist {

    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    event Claimed(address claimant, uint256 week, uint256 balance);
    event RemovedFundManager(address indexed _address);

    IERC20 public token;

    mapping(uint256 => bytes32) public merkleRoots;
    mapping(uint256 => mapping(address => bool)) public claimed;
    uint256 latestTranche;

    struct Claim {
        uint256 tranche;
        uint256 balance;
        bytes32[] merkleProof;
    }

    constructor(
      address _nexus,
      address[] memory _fundManagers,
      IERC20 _token
    )
        public
    {
        InitializableGovernableWhitelist._initialize(_nexus, _fundManagers);
        token = _token;
    }

    /***************************************
                    ADMIN
    ****************************************/

    function seedNewAllocations(bytes32 _merkleRoot, uint256 _totalAllocation)
        external
        onlyWhitelisted
        returns (uint256 weekId)
    {
        require(token.transferFrom(msg.sender, address(this), _totalAllocation), "Must receive token from sender");

        latestTranche += 1;
        merkleRoots[latestTranche] = _merkleRoot;

        return latestTranche;
    }

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
        Claim calldata _claim
    )
        external
    {
        _claimWeek(_liquidityProvider, _claim);
        _disburse(_liquidityProvider, _claim.balance);
    }


    function claimWeeks(
        address _liquidityProvider,
        Claim[] calldata claims
    )
        external
    {
        uint256 totalBalance = 0;
        for(uint256 i = 0; i < claims.length; i++) {
            Claim memory claim = claims[i];
            _claimWeek(_liquidityProvider, claim);
            totalBalance = totalBalance.add(claim.balance);
        }
        _disburse(_liquidityProvider, totalBalance);
    }

    function _claimWeek(address _liquidityProvider, Claim memory _claim)
        private
    {
        require(_claim.tranche <= latestTranche, "Week cannot be in the future");

        require(!claimed[_claim.tranche][_liquidityProvider], "LP has already claimed");
        require(_verifyClaim(_liquidityProvider, _claim), "Incorrect merkle proof");

        claimed[_claim.tranche][_liquidityProvider] = true;

        emit Claimed(_liquidityProvider, _claim.tranche, _claim.balance);
    }

    function verifyClaim(
        address _liquidityProvider,
        Claim calldata _claim
    )
        external
        view
        returns (bool valid)
    {
        return _verifyClaim(_liquidityProvider, _claim);
    }

    function _verifyClaim(
        address _liquidityProvider,
        Claim memory _claim
    )
        private
        view
        returns (bool valid)
    {
        bytes32 leaf = keccak256(abi.encodePacked(_liquidityProvider, _claim.balance));
        return MerkleProof.verify(_claim.merkleProof, merkleRoots[_claim.tranche], leaf);
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