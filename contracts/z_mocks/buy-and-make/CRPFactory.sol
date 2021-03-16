// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;


abstract contract CRPFactory {

    struct Rights {
        bool canPauseSwapping;
        bool canChangeSwapFee;
        bool canChangeWeights;
        bool canAddRemoveTokens;
        bool canWhitelistLPs;
        bool canChangeCap;
    }

    struct PoolParams {
        string poolTokenSymbol;
        string poolTokenName;
        address[] constituentTokens;
        uint[] tokenBalances;
        uint[] tokenWeights;
        uint swapFee;
    }

    function newCrp(
        address factoryAddress,
        PoolParams calldata poolParams,
        Rights calldata rights
    )
        external
        virtual
        returns (address);
}