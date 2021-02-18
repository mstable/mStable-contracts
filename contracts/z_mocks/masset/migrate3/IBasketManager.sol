// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { Basket } from "./MassetStructsV2.sol";

interface IBasketManager {
    function getBassetIntegrator(address _bAsset)
        external
        view
        returns (address integrator);

    function getBasket()
        external
        view
        returns (Basket memory b);
}