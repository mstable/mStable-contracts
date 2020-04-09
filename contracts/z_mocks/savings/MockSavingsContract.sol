pragma solidity 0.5.16;

import { SavingsContract } from "../../savings/SavingsContract.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockSavingsContract is SavingsContract {

    constructor(address _nexus, IERC20 _mUSD)
        public
        SavingsContract(_nexus, _mUSD)
    {

    }
}