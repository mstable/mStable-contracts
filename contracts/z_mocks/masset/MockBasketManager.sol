pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

import { BasketManager } from "../../masset/BasketManager.sol";
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
    function setBassetStatus(address bAsset, BassetStatus newStatus)
        external
    {
        (, uint8 index) = _isAssetInBasket(bAsset);
        basket.bassets[index].status = newStatus;
    }
    function setBassetRatio(address bAsset, uint256 _newRatio)
        external
    {
        (, uint8 index) = _isAssetInBasket(bAsset);
        basket.bassets[index].ratio = _newRatio;
    }
    function setRecol(bool undergoingRecol)
        external
    {
        basket.undergoingRecol = undergoingRecol;
    }
}



// This mock returns an invalid forge from the prepareForgeBasset call
contract MockBasketManager1 is BasketManager {

    Basset private testBasset;
    Basket private testBasket;

    constructor(address _bAsset) public {
        testBasset = Basset({
            addr: _bAsset,
            ratio: StableMath.getRatioScale(),
            maxWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: false
        });
        basket.collateralisationRatio = 1e18;
    }

    function getBasket()
        external
        view
        returns (
            Basket memory b
        )
    {
        return basket;
    }

    function prepareForgeBasset(address /*_amts*/, uint256 /*_amt*/, bool /*_mint*/)
        external
        returns (
            bool isValid,
            BassetDetails memory bInfo
        )
    {
        bInfo = BassetDetails({
            bAsset: testBasset,
            integrator: address(0),
            index: 0
        });
        isValid = false;
    }

    function prepareForgeBassets(
        address[] calldata /*_amts*/,
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
            indexes: indexes
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
            maxWeight: 0,
            vaultBalance: 0,
            status: BassetStatus.Normal,
            isTransferFeeCharged: false
        });
    }

    function prepareForgeBasset(address /*_token*/, uint256 /*_amt*/, bool /*_mint*/)
        external
        returns (
            bool isValid,
            BassetDetails memory bInfo
        )
    {
        bInfo = BassetDetails({
            bAsset: testBasset,
            integrator: address(0),
            index: 0
        });
        isValid = true;
    }

    function prepareForgeBassets(
        address[] calldata /*bassets*/,
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
            indexes: indexes
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

