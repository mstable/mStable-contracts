// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;
pragma abicoder v2;

// External
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";

// Internal
import { MassetStructs } from "../masset/MassetStructs.sol";

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
library FeederManager {
    using SafeERC20 for IERC20;
    using StableMath for uint256;

    event BassetsMigrated(address[] bAssets, address newIntegrator);
    event StartRampA(uint256 currentA, uint256 targetA, uint256 startTime, uint256 rampEndTime);
    event StopRampA(uint256 currentA, uint256 time);

    uint256 private constant MIN_RAMP_TIME = 1 days;
    uint256 private constant MAX_A = 1e6;

    /**
     * @dev Collects the interest generated from the Basket, minting a relative
     *      amount of mAsset and sending it over to the SavingsManager.
     * @param _bAssetPersonal   Basset personal storage array
     * @param _bAssetData       Basset data storage array
     * @return idxs             Array [0,1]
     * @return rawGains         Raw increases in vault Balance
     */
    function calculatePlatformInterest(
        MassetStructs.BassetPersonal[] memory _bAssetPersonal,
        MassetStructs.BassetData[] storage _bAssetData
    ) external returns (uint8[] memory idxs, uint256[] memory rawGains) {
        // Get basket details
        MassetStructs.BassetData[] memory bAssetData_ = _bAssetData;
        uint256 count = bAssetData_.length;
        idxs = new uint8[](count);
        rawGains = new uint256[](count);
        // 1. Calculate rawGains in each bAsset, in comparison to current vault balance
        for (uint256 i = 0; i < count; i++) {
            idxs[i] = uint8(i);
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
    }

    /**
     * @dev Transfers all collateral from one lending market to another - used initially
     *      to handle the migration between Aave V1 and Aave V2. Note - only supports non
     *      tx fee enabled assets. Supports going from no integration to integration, but
     *      not the other way around.
     * @param _bAssetPersonal   Basset data storage array
     * @param _bAssets          Array of basket assets to migrate
     * @param _newIntegration   Address of the new platform integration
     */
    function migrateBassets(
        MassetStructs.BassetPersonal[] storage _bAssetPersonal,
        address[] calldata _bAssets,
        address _newIntegration
    ) external {
        uint256 len = _bAssets.length;
        require(len > 0, "Must migrate some bAssets");

        for (uint256 i = 0; i < len; i++) {
            // 1. Check that the bAsset is in the basket
            address bAsset = _bAssets[i];
            uint256 index = _getAssetIndex(_bAssetPersonal, bAsset);
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

    function _getAssetIndex(MassetStructs.BassetPersonal[] storage _bAssetPersonal, address _asset)
        internal
        view
        returns (uint8 idx)
    {
        uint256 len = _bAssetPersonal.length;
        for (uint8 i = 0; i < len; i++) {
            if (_bAssetPersonal[i].addr == _asset) return i;
        }
        revert("Invalid asset");
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
            if (_recipient == address(this)) return;
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
