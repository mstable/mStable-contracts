// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { BasketV2 } from "./MassetStructsV2.sol";

interface IBasketManager {
    function getBasket() external view returns (BasketV2 memory b);
}