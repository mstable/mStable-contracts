pragma solidity ^0.5.12;

import { IEcosystemRewards } from "./IEcosystemRewards.sol";
import { AbstractMassetRewards } from "./AbstractMassetRewards.sol";

import { IMasset } from "../interfaces/IMasset.sol";
import { ISystok } from "../interfaces/ISystok.sol";

/**
 * @title EcosystemRewardsMUSD
 */
contract EcosystemRewardsMUSD is AbstractMassetRewards, IEcosystemRewards {

    constructor(IMasset _mUSD, ISystok _MTA, address _governor)
      public
      AbstractMassetRewards(_mUSD, _MTA, _governor) {
    }

}
