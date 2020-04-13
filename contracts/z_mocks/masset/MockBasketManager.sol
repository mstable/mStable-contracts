pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { BasketManager } from "../../masset/BasketManager.sol";
import { MassetStructs } from "../../masset/shared/MassetStructs.sol";
import { StableMath } from "../../shared/StableMath.sol";

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

    function prepareForgeBasset(address /*bitmap*/, uint256 /*_amt*/, bool /*_mint*/)
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
        uint32 /*bitmap*/,
        uint8 /*bitmap*/,
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

contract MockBasketManager3 is BasketManager {
    function failBasket() public {
        basket.failed = true;
    }

    function setBassetStatus(address _bAsset, BassetStatus _status) public {
        (bool exists, uint8 index) = _isAssetInBasket(_bAsset);
        require(exists, "bAsset does not exist");
        basket.bassets[index].status = _status;
    }

}

