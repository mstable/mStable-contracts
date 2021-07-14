// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

interface IBoostDirector {
    function getBalance(address _user) external returns (uint256);

    function setDirection(
        address _old,
        address _new,
        bool _pokeNew
    ) external;

    function whitelistVaults(address[] calldata _vaults) external;
}
