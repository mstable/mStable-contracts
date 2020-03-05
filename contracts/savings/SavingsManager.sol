pragma solidity 0.5.16;

import { IMasset } from "../interfaces/IMasset.sol";
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";
import { ISavingsContract } from "../interfaces/ISavingsContract.sol";

import { Module } from "../shared/Module.sol";

import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title SavingsManager
 */
contract SavingsManager is ISavingsManager, Module {

    using SafeMath for uint256;

    mapping(address => ISavingsContract) public savingsContracts;
    mapping(address => uint256) public mAssetVault;
    bool private frozen = false;

    constructor(
        address _nexus,
        address _mUSD,
        ISavingsContract _savingsContract
    )
        Module(_nexus)
        public
    {
        savingsContracts[_mUSD] = _savingsContract;
    }

    /**
      * @dev Verifies that the caller either Manager or Gov
      */
    modifier notFrozen() {
        require(!frozen, "Contract is frozen");
        _;
    }


    function collectAndDistributeInterest(address _mAsset)
        external
        notFrozen
    {
        // do something
    }

    function collectInterest(address _mAsset)
        external
        notFrozen
    {
        IMasset mAsset = IMasset(_mAsset);
        uint256 newMasset = mAsset.recalculateCollateral();

        // TODO -> Validate that the collected interest is under some sort of threshold to avoid attacks
        // ensure balanceOf this >= newMasset ?

        mAssetVault[_mAsset] = mAssetVault[_mAsset].add(newMasset);
    }

    function distributeInterest(address _mAsset)
        external
        notFrozen
    {
        // Get the amount of mAsset in the vault
        // Approve ISavingsContract
        // Call depositInterest on contract
    }
}
