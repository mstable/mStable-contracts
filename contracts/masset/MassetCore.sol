pragma solidity ^0.5.12;

// TODO (bytecode): use custom (lite) interfaces
import { IManager } from "../interfaces/IManager.sol";
import { ISystok } from "../interfaces/ISystok.sol";
import { IForgeLib } from "./libs/IForgeLib.sol";

// TODO (bytecode): investigate how public methods reduce bytecode
import { StableMath } from "../shared/math/StableMath.sol";

/**
 * @title MassetCore
 * @dev Core fields and accessors for Masset to conduct Admin
 */
contract MassetCore {

    using StableMath for uint256;

    // TODO (bytecode): investigate struct usage to reduce size
    /** @dev Modules */
    IManager internal manager;
    ISystok internal systok;

    /** @dev Lib to validate forge quantities */
    IForgeLib forgeLib;

    /** @dev Meta information for ecosystem fees */
    uint256 public mintingFee;
    uint256 public redemptionFee;

    /** @dev Maximum minting/redemption fee (20%) */
    uint256 internal constant maxFee = 2e17;

    /** @dev Maximum allowance for flexibility in the basket adjusments (1%) */
    uint256 internal constant minGrace = 1e16;

    /** @dev Events to emit */
    event MintingFeeChanged(uint256 fee);
    event RedemptionFeeChanged(uint256 fee);

    /**
      * @dev Verifies that the caller is the Manager
      */
    modifier onlyManager() {
        require(address(manager) == msg.sender, "Must be manager");
        _;
    }

    // TODO (bytecode): maybe we can reduce number of funcs by having a `setAddresses` func, taking an array of addr
    // This will reduce bytecode size. Could also have 'setParams` where we also set mint/redemtpion/grace etc
    // Or use an enum to determine which thing to update.. could have 1 method taking enum and bytes32 content

    /**
      * @dev Manager can set the address of the new Manager here
      * @param _manager Address of the new Manager
      */
    function setManager(IManager _manager)
    external
    onlyManager {
        manager = _manager;
    }

    /**
      * @dev Manager can set the address of the System Token here
      * @param _systok Address of the new Systok
      */
    function setSystok(ISystok _systok)
    external
    onlyManager {
        require(address(_systok) != address(0), "Must be non null address");
        systok = _systok;
    }

    /**
      * @dev Upgrades the version of ForgeLib protocol
      * @param _newForgeLib Address of the new ForgeLib
      */
    function upgradeForgeLib(address _newForgeLib)
    external
    onlyManager {
        require(_newForgeLib != address(0), "Must be non null address");
        forgeLib = IForgeLib(_newForgeLib);
    }

    /**
      * @dev Set the ecosystem fee for minting a masset
      * @param _mintingFee Fee calculated in (%/100 * 1e18)
      */
    function setMintingFee(uint256 _mintingFee)
    external
    onlyManager {
        require(_mintingFee <= maxFee, "Minting fee > maxFee");
        mintingFee = _mintingFee;
        emit MintingFeeChanged(_mintingFee);
    }

    /**
      * @dev Set the ecosystem fee for redeeming a masset
      * @param _redemptionFee Fee calculated in (%/100 * 1e18)
      */
    function setRedemptionFee(uint256 _redemptionFee)
    external
    onlyManager {
        require(_redemptionFee <= maxFee, "Redemption fee > maxFee");
        redemptionFee = _redemptionFee;
        emit RedemptionFeeChanged(_redemptionFee);
    }

}