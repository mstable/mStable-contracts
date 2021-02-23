// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

// External
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";
import { IInvariantValidator } from "./IInvariantValidator.sol";
import { IBasicToken } from "../shared/IBasicToken.sol";

// Internal
import { MassetStructs } from "./MassetStructs.sol";

// Libs
import { SafeCast } from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { StableMath } from "../shared/StableMath.sol";
import { MassetHelpers } from "../shared/MassetHelpers.sol";

/**
 * @title   Manager
 * @author  mStable
 * @notice  Simply contains logic to perform Basket Manager duties for an mAsset.
 *          Allowing logic can be abstracted here to avoid bytecode inflation.
 * @dev     VERSION: 1.0
 *          DATE:    2021-01-22
 */
library Manager {
    using SafeERC20 for IERC20;
    using StableMath for uint256;

    event BassetsMigrated(address[] bAssets, address newIntegrator);
    event TransferFeeEnabled(address indexed bAsset, bool enabled);
    event BassetAdded(address indexed bAsset, address integrator);
    event BassetStatusChanged(address indexed bAsset, MassetStructs.BassetStatus status);
    event BasketStatusChanged();
    event StartRampA(uint256 currentA, uint256 targetA, uint256 startTime, uint256 rampEndTime);
    event StopRampA(uint256 currentA, uint256 time);

    uint256 private constant MIN_RAMP_TIME = 1 days;
    uint256 private constant MAX_A = 1e6;

    /**
     * @notice Adds a bAsset to the given personal, data and mapping, provided it is valid
     * @param _bAssetPersonal   Basset data storage array
     * @param _bAssetData       Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _maxBassets       Max size of the basket
     * @param _bAsset           Address of the ERC20 token to add to the Basket
     * @param _integration      Address of the Platform Integration
     * @param _mm               Base 1e8 var to determine measurement ratio
     * @param _hasTxFee         Are transfer fees charged on this bAsset (e.g. USDT)
     */
    function addBasset(
        MassetStructs.BassetPersonal[] storage _bAssetPersonal,
        MassetStructs.BassetData[] storage _bAssetData,
        mapping(address => uint8) storage _bAssetIndexes,
        uint8 _maxBassets,
        address _bAsset,
        address _integration,
        uint256 _mm,
        bool _hasTxFee
    ) external {
        require(_bAsset != address(0), "bAsset address must be valid");
        uint8 bAssetCount = uint8(_bAssetPersonal.length);
        require(bAssetCount < _maxBassets, "Max bAssets in Basket");

        uint8 idx = _bAssetIndexes[_bAsset];
        require(
            bAssetCount == 0 || _bAssetPersonal[idx].addr != _bAsset,
            "bAsset already exists in Basket"
        );

        // Should fail if bAsset is not added to integration
        // Programmatic enforcement of bAsset validity should service through decentralised feed
        if (_integration != address(0)) {
            IPlatformIntegration(_integration).checkBalance(_bAsset);
        }

        uint256 bAssetDecimals = IBasicToken(_bAsset).decimals();
        require(
            bAssetDecimals >= 4 && bAssetDecimals <= 18,
            "Token must have sufficient decimal places"
        );

        uint256 delta = uint256(18) - bAssetDecimals;
        uint256 ratio = _mm * (10**delta);

        _bAssetIndexes[_bAsset] = bAssetCount;

        _bAssetPersonal.push(
            MassetStructs.BassetPersonal({
                addr: _bAsset,
                integrator: _integration,
                hasTxFee: _hasTxFee,
                status: MassetStructs.BassetStatus.Normal
            })
        );
        _bAssetData.push(
            MassetStructs.BassetData({ ratio: SafeCast.toUint128(ratio), vaultBalance: 0 })
        );

        emit BassetAdded(_bAsset, _integration);
    }

    /**
     * @dev Collects the interest generated from the Basket, minting a relative
     *      amount of mAsset and sending it over to the SavingsManager.
     * @param _bAssetPersonal   Basset personal storage array
     * @param _bAssetData       Basset data storage array
     * @param _forgeValidator   Link to the current InvariantValidator
     * @return mintAmount       Lending market interest collected
     * @return rawGains         Raw increases in vault Balance
     */
    function collectPlatformInterest(
        MassetStructs.BassetPersonal[] memory _bAssetPersonal,
        MassetStructs.BassetData[] storage _bAssetData,
        IInvariantValidator _forgeValidator,
        MassetStructs.InvariantConfig memory _config
    ) external returns (uint256 mintAmount, uint256[] memory rawGains) {
        // Get basket details
        MassetStructs.BassetData[] memory bAssetData_ = _bAssetData;
        uint256 count = bAssetData_.length;
        uint8[] memory indices = new uint8[](count);
        rawGains = new uint256[](count);
        // 1. Calculate rawGains in each bAsset, in comparison to current vault balance
        for (uint256 i = 0; i < count; i++) {
            indices[i] = uint8(i);
            MassetStructs.BassetPersonal memory bPersonal = _bAssetPersonal[i];
            MassetStructs.BassetData memory bData = bAssetData_[i];
            // If there is no integration, then nothing can have accrued
            if (bPersonal.integrator == address(0)) continue;
            uint256 lending =
                IPlatformIntegration(bPersonal.integrator).checkBalance(bPersonal.addr);
            uint256 cache = 0;
            if (!bPersonal.hasTxFee) {
                cache = IERC20(bPersonal.addr).balanceOf(bPersonal.integrator);
            }
            uint256 balance = lending + cache;
            uint256 oldVaultBalance = bData.vaultBalance;
            if (
                balance > oldVaultBalance && bPersonal.status == MassetStructs.BassetStatus.Normal
            ) {
                _bAssetData[i].vaultBalance = SafeCast.toUint128(balance);
                uint256 interestDelta = balance - oldVaultBalance;
                rawGains[i] = interestDelta;
            } else {
                rawGains[i] = 0;
            }
        }
        mintAmount = _forgeValidator.computeMintMulti(bAssetData_, indices, rawGains, _config);
    }

    /**
     * @dev Update transfer fee flag for a given bAsset, should it change its fee practice
     * @param _bAssetPersonal   Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _bAsset   bAsset address
     * @param _flag         Charge transfer fee when its set to 'true', otherwise 'false'
     */
    function setTransferFeesFlag(
        MassetStructs.BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _bAsset,
        bool _flag
    ) external {
        uint256 index = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, _bAsset);
        _bAssetPersonal[index].hasTxFee = _flag;

        if (_flag) {
            // if token has tx fees, it can no longer operate with a cache
            address integration = _bAssetPersonal[index].integrator;
            if (integration != address(0)) {
                uint256 bal = IERC20(_bAsset).balanceOf(integration);
                if (bal > 0) {
                    IPlatformIntegration(integration).deposit(_bAsset, bal, true);
                }
            }
        }

        emit TransferFeeEnabled(_bAsset, _flag);
    }

    /**
     * @dev Transfers all collateral from one lending market to another - used initially
     *      to handle the migration between Aave V1 and Aave V2. Note - only supports non
     *      tx fee enabled assets. Supports going from no integration to integration, but
     *      not the other way around.
     * @param _bAssetPersonal   Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _bAssets          Array of basket assets to migrate
     * @param _newIntegration   Address of the new platform integration
     */
    function migrateBassets(
        MassetStructs.BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address[] calldata _bAssets,
        address _newIntegration
    ) external {
        uint256 len = _bAssets.length;
        require(len > 0, "Must migrate some bAssets");

        for (uint256 i = 0; i < len; i++) {
            // 1. Check that the bAsset is in the basket
            address bAsset = _bAssets[i];
            uint256 index = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, bAsset);
            require(!_bAssetPersonal[index].hasTxFee, "A bAsset has a transfer fee");

            // 2. Withdraw everything from the old platform integration
            address oldAddress = _bAssetPersonal[index].integrator;
            require(oldAddress != _newIntegration, "Must transfer to new integrator");
            (uint256 cache, uint256 lendingBal) = (0, 0);
            if (oldAddress == address(0)) {
                cache = IERC20(bAsset).balanceOf(address(this));
            } else {
                IPlatformIntegration oldIntegration = IPlatformIntegration(oldAddress);
                cache = IERC20(bAsset).balanceOf(address(oldIntegration));
                // 2.1. Withdraw from the lending market
                lendingBal = oldIntegration.checkBalance(bAsset);
                if (lendingBal > 0) {
                    oldIntegration.withdraw(address(this), bAsset, lendingBal, false);
                }
                // 2.2. Withdraw from the cache, if any
                if (cache > 0) {
                    oldIntegration.withdrawRaw(address(this), bAsset, cache);
                }
            }
            uint256 sum = lendingBal + cache;

            // 3. Update the integration address for this bAsset
            _bAssetPersonal[index].integrator = _newIntegration;

            // 4. Deposit everything into the new
            //    This should fail if we did not receive the full amount from the platform withdrawal
            // 4.1. Deposit all bAsset
            IERC20(bAsset).safeTransfer(_newIntegration, sum);
            IPlatformIntegration newIntegration = IPlatformIntegration(_newIntegration);
            if (lendingBal > 0) {
                newIntegration.deposit(bAsset, lendingBal, false);
            }
            // 4.2. Check balances
            uint256 newLendingBal = newIntegration.checkBalance(bAsset);
            uint256 newCache = IERC20(bAsset).balanceOf(address(newIntegration));
            uint256 upperMargin = 10001e14;
            uint256 lowerMargin = 9999e14;

            require(
                newLendingBal >= lendingBal.mulTruncate(lowerMargin) &&
                    newLendingBal <= lendingBal.mulTruncate(upperMargin),
                "Must transfer full amount"
            );
            require(
                newCache >= cache.mulTruncate(lowerMargin) &&
                    newCache <= cache.mulTruncate(upperMargin),
                "Must transfer full amount"
            );
        }

        emit BassetsMigrated(_bAssets, _newIntegration);
    }

    /**
     * @dev Executes the Auto Redistribution event by isolating the bAsset from the Basket
     * @param _basket          Struct containing core basket info
     * @param _bAssetPersonal  Basset data storage array
     * @param _bAsset          Address of the ERC20 token to isolate
     * @param _belowPeg        Bool to describe whether the bAsset deviated below peg (t)
     *                         or above (f)
     */
    function handlePegLoss(
        MassetStructs.BasketState storage _basket,
        MassetStructs.BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _bAsset,
        bool _belowPeg
    ) external {
        require(!_basket.failed, "Basket must be alive");

        uint256 i = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, _bAsset);

        MassetStructs.BassetStatus newStatus =
            _belowPeg
                ? MassetStructs.BassetStatus.BrokenBelowPeg
                : MassetStructs.BassetStatus.BrokenAbovePeg;
        _bAssetPersonal[i].status = newStatus;

        _basket.undergoingRecol = true;

        emit BassetStatusChanged(_bAsset, newStatus);
    }

    /**
     * @dev Negates the isolation of a given bAsset
     * @param _basket          Struct containing core basket info
     * @param _bAssetPersonal  Basset data storage array
     * @param _bAssetIndexes    Mapping of bAsset address to their index
     * @param _bAsset Address of the bAsset
     */
    function negateIsolation(
        MassetStructs.BasketState storage _basket,
        MassetStructs.BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _bAsset
    ) external {
        uint256 i = _getAssetIndex(_bAssetPersonal, _bAssetIndexes, _bAsset);

        _bAssetPersonal[i].status = MassetStructs.BassetStatus.Normal;

        bool undergoingRecol = false;
        for (uint256 j = 0; j < _bAssetPersonal.length; j++) {
            if (_bAssetPersonal[j].status != MassetStructs.BassetStatus.Normal) {
                undergoingRecol = true;
                break;
            }
        }
        _basket.undergoingRecol = undergoingRecol;

        emit BassetStatusChanged(_bAsset, MassetStructs.BassetStatus.Normal);
    }

    /**
     * @dev Starts changing of the amplification var A
     * @param _targetA      Target A value
     * @param _rampEndTime  Time at which A will arrive at _targetA
     */
    function startRampA(
        MassetStructs.AmpData storage _ampData,
        uint256 _targetA,
        uint256 _rampEndTime,
        uint256 _currentA,
        uint256 _precision
    ) external {
        require(
            block.timestamp >= (_ampData.rampStartTime + MIN_RAMP_TIME),
            "Sufficient period of previous ramp has not elapsed"
        );
        require(_rampEndTime >= (block.timestamp + MIN_RAMP_TIME), "Ramp time too short");
        require(_targetA > 0 && _targetA < MAX_A, "A target out of bounds");

        uint256 preciseTargetA = _targetA * _precision;

        if (preciseTargetA > _currentA) {
            require(preciseTargetA <= _currentA * 10, "A target increase too big");
        } else {
            require(preciseTargetA >= _currentA / 10, "A target decrease too big");
        }

        _ampData.initialA = SafeCast.toUint64(_currentA);
        _ampData.targetA = SafeCast.toUint64(preciseTargetA);
        _ampData.rampStartTime = SafeCast.toUint64(block.timestamp);
        _ampData.rampEndTime = SafeCast.toUint64(_rampEndTime);

        emit StartRampA(_currentA, preciseTargetA, block.timestamp, _rampEndTime);
    }

    /**
     * @dev Stops the changing of the amplification var A, setting
     * it to whatever the current value is.
     */
    function stopRampA(MassetStructs.AmpData storage _ampData, uint256 _currentA) external {
        require(block.timestamp < _ampData.rampEndTime, "Amplification not changing");

        _ampData.initialA = SafeCast.toUint64(_currentA);
        _ampData.targetA = SafeCast.toUint64(_currentA);
        _ampData.rampStartTime = SafeCast.toUint64(block.timestamp);
        _ampData.rampEndTime = SafeCast.toUint64(block.timestamp);

        emit StopRampA(_currentA, block.timestamp);
    }

    /**
     * @dev Gets a bAsset index from storage
     * @param _asset      Address of the asset
     * @return idx        Index of the asset
     */
    function _getAssetIndex(
        MassetStructs.BassetPersonal[] storage _bAssetPersonal,
        mapping(address => uint8) storage _bAssetIndexes,
        address _asset
    ) internal view returns (uint8 idx) {
        idx = _bAssetIndexes[_asset];
        require(_bAssetPersonal[idx].addr == _asset, "Invalid asset input");
    }

    /***************************************
                    FORGING
    ****************************************/

    /**
     * @dev Deposits a given asset to the system. If there is sufficient room for the asset
     * in the cache, then just transfer, otherwise reset the cache to the desired mid level by
     * depositing the delta in the platform
     */
    function depositTokens(
        MassetStructs.BassetPersonal memory _bAsset,
        uint256 _bAssetRatio,
        uint256 _quantity,
        uint256 _maxCache
    ) external returns (uint256 quantityDeposited) {
        // 0. If integration is 0, short circuit
        if (_bAsset.integrator == address(0)) {
            (uint256 received, ) =
                MassetHelpers.transferReturnBalance(
                    msg.sender,
                    address(this),
                    _bAsset.addr,
                    _quantity
                );
            return received;
        }

        // 1 - Send all to PI, using the opportunity to get the cache balance and net amount transferred
        uint256 cacheBal;
        (quantityDeposited, cacheBal) = MassetHelpers.transferReturnBalance(
            msg.sender,
            _bAsset.integrator,
            _bAsset.addr,
            _quantity
        );

        // 2 - Deposit X if necessary
        // 2.1 - Deposit if xfer fees
        if (_bAsset.hasTxFee) {
            uint256 deposited =
                IPlatformIntegration(_bAsset.integrator).deposit(
                    _bAsset.addr,
                    quantityDeposited,
                    true
                );

            return StableMath.min(deposited, quantityDeposited);
        }
        // 2.2 - Else Deposit X if Cache > %
        // This check is in place to ensure that any token with a txFee is rejected
        require(quantityDeposited == _quantity, "Asset not fully transferred");

        uint256 relativeMaxCache = _maxCache.divRatioPrecisely(_bAssetRatio);

        if (cacheBal > relativeMaxCache) {
            uint256 delta = cacheBal - (relativeMaxCache / 2);
            IPlatformIntegration(_bAsset.integrator).deposit(_bAsset.addr, delta, false);
        }
    }

    /**
     * @dev Withdraws a given asset from its platformIntegration. If there is sufficient liquidity
     * in the cache, then withdraw from there, otherwise withdraw from the lending market and reset the
     * cache to the mid level.
     */
    function withdrawTokens(
        uint256 _quantity,
        MassetStructs.BassetPersonal memory _personal,
        MassetStructs.BassetData memory _data,
        address _recipient,
        uint256 _maxCache
    ) external {
        if (_quantity == 0) return;

        // 1.0 If there is no integrator, send from here
        if (_personal.integrator == address(0)) {
            IERC20(_personal.addr).safeTransfer(_recipient, _quantity);
        }
        // 1.1 If txFee then short circuit - there is no cache
        else if (_personal.hasTxFee) {
            IPlatformIntegration(_personal.integrator).withdraw(
                _recipient,
                _personal.addr,
                _quantity,
                _quantity,
                true
            );
        }
        // 1.2. Else, withdraw from either cache or main vault
        else {
            uint256 cacheBal = IERC20(_personal.addr).balanceOf(_personal.integrator);
            // 2.1 - If balance b in cache, simply withdraw
            if (cacheBal >= _quantity) {
                IPlatformIntegration(_personal.integrator).withdrawRaw(
                    _recipient,
                    _personal.addr,
                    _quantity
                );
            }
            // 2.2 - Else reset the cache to X, or as far as possible
            //       - Withdraw X+b from platform
            //       - Send b to user
            else {
                uint256 relativeMidCache = _maxCache.divRatioPrecisely(_data.ratio) / 2;
                uint256 totalWithdrawal =
                    StableMath.min(
                        relativeMidCache + _quantity - cacheBal,
                        _data.vaultBalance - SafeCast.toUint128(cacheBal)
                    );

                IPlatformIntegration(_personal.integrator).withdraw(
                    _recipient,
                    _personal.addr,
                    _quantity,
                    totalWithdrawal,
                    false
                );
            }
        }
    }
}
