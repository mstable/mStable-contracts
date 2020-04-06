pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { MassetStructs } from "../../masset/shared/MassetStructs.sol";
import { BasketManager } from "../../masset/BasketManager.sol";
import { StableMath } from "../../shared/StableMath.sol";

// This mock allows the direct setting of basket properties
contract MockBasketManager is BasketManager {

    function setBasket(bool failed, uint256 colRatio)
        external
    {
        basket.failed = failed;
        basket.collateralisationRatio = colRatio;
    }
}



// This mock returns an invalid forge from the prepareForgeBasset call
contract MockBasketManager1 is MassetStructs {

    Basset private testBasset;

    constructor(address _bAsset) public {
        testBasset = Basset({
            addr: _bAsset,
            ratio: StableMath.getRatioScale(),
            targetWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: false
        });
    }

    function prepareForgeBasset(address /*_amts*/, uint256 /*_amt*/, bool /*_mint*/)
        external
        returns (
            ForgeProps memory props
        )
    {
        return ForgeProps({
            isValid: false,
            bAsset: testBasset,
            integrator: address(0),
            index: 0,
            grace: 0
        });
    }

    function prepareForgeBassets(
        uint32 /*_amts*/,
        uint8 /*_amts*/,
        uint256[] calldata /*_amts*/,
        bool /* _isMint */
    )
        external
        returns (ForgePropsMulti memory props)
    {
        Basset[] memory bAssets = new Basset[](1);
        address[] memory integrators = new address[](1);
        uint8[] memory indexes = new uint8[](1);
        bAssets[0] = testBasset;
        integrators[0] = address(0);
        indexes[0] = 0;
        return ForgePropsMulti({
            isValid: false,
            bAssets: bAssets,
            integrators: integrators,
            indexes: indexes,
            grace: 0
        });
    }
}


// This mock returns an invalid integrator from the prepareForgeBasset call
contract MockBasketManager2 is MassetStructs {

    Basset private testBasset;

    constructor(address _bAsset) public {
        testBasset = Basset({
            addr: _bAsset,
            ratio: StableMath.getRatioScale(),
            targetWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: false
        });
    }

    function prepareForgeBasset(address /*_token*/, uint256 /*_amt*/, bool /*_mint*/)
        external
        returns (
            ForgeProps memory props
        )
    {
        return ForgeProps({
            isValid: true,
            bAsset: testBasset,
            integrator: address(0),
            index: 0,
            grace: 0
        });
    }

    function prepareForgeBassets(
        uint32 /*bitmap*/,
        uint8 /*_size*/,
        uint256[] calldata /*_amts*/,
        bool /* _isMint */
    )
        external
        returns (ForgePropsMulti memory props)
    {
        Basset[] memory bAssets = new Basset[](1);
        address[] memory integrators = new address[](1);
        uint8[] memory indexes = new uint8[](1);
        bAssets[0] = testBasset;
        integrators[0] = address(0);
        indexes[0] = 0;
        return ForgePropsMulti({
            isValid: true,
            bAssets: bAssets,
            integrators: integrators,
            indexes: indexes,
            grace: 0
        });
    }
}

