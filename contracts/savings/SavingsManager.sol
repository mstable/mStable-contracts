pragma solidity 0.5.16;

import { IMasset } from "../interfaces/IMasset.sol";
import { ISavingsManager } from "../interfaces/ISavingsManager.sol";

import { Module } from "../shared/Module.sol";

import { IERC20 }     from "openzeppelin-solidity/contracts/token/ERC20/IERC20.sol";
import { SafeMath } from "openzeppelin-solidity/contracts/math/SafeMath.sol";

/**
 * @title SavingsManager
 */
contract SavingsManager is ISavingsManager, Module {

    using SafeMath for uint256;

    constructor(
        address _nexus

    )
        Module(_nexus)
        public
    {
    }


    function collectAndDistributeInterest(address _mAsset) external {
      // do something
    }

}
