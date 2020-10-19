pragma solidity 0.5.16;

import { ICurveMetaPool } from "../../masset/liquidator/ICurveMetaPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";


// Simulates the selling of bAsset for mUSD through Meta Pool
// Assumes mUSD is token 0
contract MockCurveMetaPool is ICurveMetaPool {

    address[] public coins;
    address mUSD;

    constructor(address[] memory _coins, address _mUSD) public {
        require(_coins[0] == _mUSD, "Coin 0 must be mUSD");
        coins = _coins;
        mUSD = _mUSD;
    }

    // takes dx i from sender, returns j
    function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 /*min_dy*/)
        external
        returns (uint256)
    {
        require(j == 0, "Output must be mUSD");
        address in_tok = coins[uint256(i)];
        uint256 decimals = IBasicToken(in_tok).decimals();
        uint256 out_amt = dx * (10 ** (18 - decimals));
        IERC20(in_tok).transferFrom(msg.sender, address(this), dx);
        IERC20(mUSD).transfer(msg.sender, out_amt);
        return out_amt;
    }
}