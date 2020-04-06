pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { BasketManager } from "../../masset/BasketManager.sol";

contract MockBasketManager is BasketManager {

    function failBasket() public {
        basket.failed = true;
    }
}