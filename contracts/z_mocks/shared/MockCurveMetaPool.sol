pragma solidity 0.5.16;

import { ICurveMetaPool } from "../../masset/liquidator/ICurveMetaPool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IBasicToken } from "../../shared/IBasicToken.sol";


// Simulates the selling of bAsset for mUSD through Meta Pool
// Assumes mUSD is token 0
contract MockCurveMetaPool is ICurveMetaPool {

    address[] public coins;
    address mUSD;
    // number of out per in (scaled)
    uint256 ratio = 98e16;


    constructor(address[] memory _coins, address _mUSD) public {
        require(_coins[0] == _mUSD, "Coin 0 must be mUSD");
        coins = _coins;
        mUSD = _mUSD;
    }

    function setRatio(uint256 _newRatio) external {
        ratio = _newRatio;
    }

    // takes dx i from sender, returns j
    function exchange_underlying(int128 i, int128 j, uint256 dx, uint256 min_dy)
        external
        returns (uint256)
    {
        require(j == 0, "Output must be mUSD");
        address in_tok = coins[uint256(i)];
        uint256 decimals = IBasicToken(in_tok).decimals();
        uint256 out_amt = dx * (10 ** (18 - decimals)) * ratio / 1e18;
        require(out_amt >= min_dy, "CRV: Output amount not enough");
        IERC20(in_tok).transferFrom(msg.sender, address(this), dx);
        IERC20(mUSD).transfer(msg.sender, out_amt);
        return out_amt;
    }


    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256) {
        require(j == 0, "Output must be mUSD");
        address in_tok = coins[uint256(i)];
        uint256 decimals = IBasicToken(in_tok).decimals();
        uint256 out_amt = dx * (10 ** (18 - decimals)) * ratio / 1e18;
        return out_amt;
    }
}