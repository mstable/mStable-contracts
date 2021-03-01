// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.1;

import { IMasset } from "../../interfaces/IMasset.sol";
import { ISavingsContractV1 } from "../../interfaces/ISavingsContract.sol";
import { IERC20 } from "../shared/MockERC20.sol";

contract MockSavingsManager {

    address public immutable save;

    constructor(address _save) {
        save = _save;
    }

    function collectAndDistributeInterest(address _mAsset) public {
        require(save != address(0), "Must have a valid savings contract");

        // 1. Collect the new interest from the mAsset
        IMasset mAsset = IMasset(_mAsset);
        (uint256 interestCollected, uint256 totalSupply) = mAsset.collectInterest();

        // 3. Validate that interest is collected correctly and does not exceed max APY
        if(interestCollected > 0) {

            IERC20(_mAsset).approve(save, interestCollected);

            ISavingsContractV1(save).depositInterest(interestCollected);
        }
    }
}