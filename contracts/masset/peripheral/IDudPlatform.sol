// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.6;

interface IDudPlatform {
    function bAsset() external view returns (address);

    function deposit(address _bAsset, uint256 _amount) external;

    function integration() external view returns (address);

    function withdraw(address _bAsset, uint256 _amount) external;
}
