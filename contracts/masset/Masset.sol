pragma solidity 0.5.16;
pragma experimental ABIEncoderV2;

// External
import { IForgeValidator } from "./forge-validator/IForgeValidator.sol";
import { IPlatformIntegration } from "../interfaces/IPlatformIntegration.sol";
import { IBasketManager } from "../interfaces/IBasketManager.sol";

// Internal
import { IMasset } from "../interfaces/IMasset.sol";
import { Initializable } from "@openzeppelin/upgrades/contracts/Initializable.sol";
import { InitializableToken } from "../shared/InitializableToken.sol";
import { InitializableModule } from "../shared/InitializableModule.sol";
import { InitializableReentrancyGuard } from "../shared/InitializableReentrancyGuard.sol";
import { MassetStructs } from "./shared/MassetStructs.sol";

// Libs
import { StableMath } from "../shared/StableMath.sol";
import { MassetHelpers } from "./shared/MassetHelpers.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title   Masset
 * @author  Stability Labs Pty. Ltd.
 * @notice  The Masset is a token that allows minting and redemption at a 1:1 ratio
 *          for underlying basket assets (bAssets) of the same peg (i.e. USD,
 *          EUR, Gold). Composition and validation is enforced via the BasketManager.
 * @dev     VERSION: 2.0
 *          DATE:    2020-11-14
 */
contract Masset is
    Initializable,
    IMasset,
    InitializableToken,
    InitializableModule,
    InitializableReentrancyGuard
{
    using StableMath for uint256;

    // Forging Events
    event Minted(address indexed minter, address recipient, uint256 mAssetQuantity, address bAsset, uint256 bAssetQuantity);
    event MintedMulti(address indexed minter, address recipient, uint256 mAssetQuantity, address[] bAssets, uint256[] bAssetQuantities);
    event Swapped(address indexed swapper, address input, address output, uint256 outputAmount, address recipient);
    event Redeemed(address indexed redeemer, address recipient, uint256 mAssetQuantity, address[] bAssets, uint256[] bAssetQuantities);
    event RedeemedMasset(address indexed redeemer, address recipient, uint256 mAssetQuantity);
    event PaidFee(address indexed payer, address asset, uint256 feeQuantity);

    // State Events
    event CacheSizeChanged(uint256 cacheSize);
    event SwapFeeChanged(uint256 fee);
    event RedemptionFeeChanged(uint256 fee);
    event ForgeValidatorChanged(address forgeValidator);

    // Modules and connectors
    IForgeValidator public forgeValidator;
    bool private forgeValidatorLocked;
    IBasketManager private basketManager;

    // Basic redemption fee information
    uint256 public swapFee;
    uint256 private MAX_FEE;

    // RELEASE 1.1 VARS
    uint256 public redemptionFee;

    // RELEASE 2.0 VARS
    uint256 public cacheSize;
    uint256 public surplus;

    /**
     * @dev Constructor
     * @notice To avoid variable shadowing appended `Arg` after arguments name.
     */
    function initialize(
        string calldata _nameArg,
        string calldata _symbolArg,
        address _nexus,
        address _forgeValidator,
        address _basketManager
    )
        external
        initializer
    {
        InitializableToken._initialize(_nameArg, _symbolArg);
        InitializableModule._initialize(_nexus);
        InitializableReentrancyGuard._initialize();

        forgeValidator = IForgeValidator(_forgeValidator);

        basketManager = IBasketManager(_basketManager);

        MAX_FEE = 2e16;
        swapFee = 6e14;
        redemptionFee = 3e14;
        cacheSize = 1e17;
    }

    /**
      * @dev Verifies that the caller is the Savings Manager contract
      */
    modifier onlySavingsManager() {
        require(_savingsManager() == msg.sender, "Must be savings manager");
        _;
    }


    /***************************************
                MINTING (PUBLIC)
    ****************************************/

    /**
     * @dev Mint a single bAsset, at a 1:1 ratio with the bAsset. This contract
     *      must have approval to spend the senders bAsset
     * @param _bAsset         Address of the bAsset to mint
     * @param _bAssetQuantity Quantity in bAsset units
     * @return massetMinted   Number of newly minted mAssets
     */
    function mint(
        address _bAsset,
        uint256 _bAssetQuantity
    )
        external
        nonReentrant
        returns (uint256 massetMinted)
    {
        return _mintTo(_bAsset, _bAssetQuantity, msg.sender);
    }

    /**
     * @dev Mint a single bAsset, at a 1:1 ratio with the bAsset. This contract
     *      must have approval to spend the senders bAsset
     * @param _bAsset         Address of the bAsset to mint
     * @param _bAssetQuantity Quantity in bAsset units
     * @param _recipient receipient of the newly minted mAsset tokens
     * @return massetMinted   Number of newly minted mAssets
     */
    function mintTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        external
        nonReentrant
        returns (uint256 massetMinted)
    {
        return _mintTo(_bAsset, _bAssetQuantity, _recipient);
    }

    /**
     * @dev Mint with multiple bAssets, at a 1:1 ratio to mAsset. This contract
     *      must have approval to spend the senders bAssets
     * @param _bAssets          Non-duplicate address array of bAssets with which to mint
     * @param _bAssetQuantity   Quantity of each bAsset to mint. Order of array
     *                          should mirror the above
     * @param _recipient        Address to receive the newly minted mAsset tokens
     * @return massetMinted     Number of newly minted mAssets
     */
    function mintMulti(
        address[] calldata _bAssets,
        uint256[] calldata _bAssetQuantity,
        address _recipient
    )
        external
        nonReentrant
        returns(uint256 massetMinted)
    {
        return _mintTo(_bAssets, _bAssetQuantity, _recipient);
    }

    /***************************************
              MINTING (INTERNAL)
    ****************************************/

    /** @dev Mint Single */
    function _mintTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Must be a valid recipient");
        require(_bAssetQuantity > 0, "Quantity must not be 0");

        (bool isValid, BassetDetails memory bInfo) = basketManager.prepareForgeBasset(_bAsset, _bAssetQuantity, true);
        if(!isValid) return 0;

        Cache memory cache = _getCacheDetails();

        // Transfer collateral to the platform integration address and call deposit
        address integrator = bInfo.integrator;
        (uint256 quantityDeposited, uint256 ratioedDeposit) =
            _depositTokens(_bAsset, bInfo.bAsset.ratio, integrator, bInfo.bAsset.isTransferFeeCharged, _bAssetQuantity, cache.maxCache);

        // Validation should be after token transfer, as bAssetQty is unknown before
        (bool mintValid, string memory reason) = forgeValidator.validateMint(cache.vaultBalanceSum, bInfo.bAsset, quantityDeposited);
        require(mintValid, reason);

        // Log the Vault increase - can only be done when basket is healthy
        basketManager.increaseVaultBalance(bInfo.index, integrator, quantityDeposited);

        // Mint the Masset
        _mint(_recipient, ratioedDeposit);
        emit Minted(msg.sender, _recipient, ratioedDeposit, _bAsset, quantityDeposited);

        return ratioedDeposit;
    }

    /** @dev Mint Multi */
    function _mintTo(
        address[] memory _bAssets,
        uint256[] memory _bAssetQuantities,
        address _recipient
    )
        internal
        returns (uint256 massetMinted)
    {
        require(_recipient != address(0), "Must be a valid recipient");
        uint256 len = _bAssetQuantities.length;
        require(len > 0 && len == _bAssets.length, "Input array mismatch");

        // Load only needed bAssets in array
        ForgePropsMulti memory props
            = basketManager.prepareForgeBassets(_bAssets, _bAssetQuantities, true);
        if(!props.isValid) return 0;

        Cache memory cache = _getCacheDetails();

        uint256 mAssetQuantity = 0;
        uint256[] memory receivedQty = new uint256[](len);

        // Transfer the Bassets to the integrator, update storage and calc MassetQ
        for(uint256 i = 0; i < len; i++){
            uint256 bAssetQuantity = _bAssetQuantities[i];
            if(bAssetQuantity > 0){
                // bAsset == bAssets[i] == basket.bassets[indexes[i]]
                Basset memory bAsset = props.bAssets[i];

                (uint256 quantityDeposited, uint256 ratioedDeposit) =
                    _depositTokens(bAsset.addr, bAsset.ratio, props.integrators[i], bAsset.isTransferFeeCharged, bAssetQuantity, cache.maxCache);

                receivedQty[i] = quantityDeposited;
                mAssetQuantity = mAssetQuantity.add(ratioedDeposit);
            }
        }
        require(mAssetQuantity > 0, "No masset quantity to mint");

        basketManager.increaseVaultBalances(props.indexes, props.integrators, receivedQty);

        // Validate the proposed mint, after token transfer
        (bool mintValid, string memory reason) = forgeValidator.validateMintMulti(cache.vaultBalanceSum, props.bAssets, receivedQty);
        require(mintValid, reason);

        // Mint the Masset
        _mint(_recipient, mAssetQuantity);
        emit MintedMulti(msg.sender, _recipient, mAssetQuantity, _bAssets, _bAssetQuantities);

        return mAssetQuantity;
    }

    /**
     * @dev Deposits a given asset to the system. If there is sufficient room for the asset
     * in the cache, then just transfer, otherwise reset the cache to the desired mid level by
     * depositing the delta in the platform
     */
    function _depositTokens(
        address _bAsset,
        uint256 _bAssetRatio,
        address _integrator,
        bool _hasTxFee,
        uint256 _quantity,
        uint256 _maxCache
    )
        internal
        returns (uint256 quantityDeposited, uint256 ratioedDeposit)
    {
        // 1 - Send all to PI, using the opportunity to get the cache balance and net amount transferred
        (uint256 transferred, uint256 cacheBal) = MassetHelpers.transferReturnBalance(msg.sender, _integrator, _bAsset, _quantity);

        // 2 - Deposit X if necessary
        //   - Can account here for non-lending market integrated bAssets by simply checking for
        //     integrator == address(0) || address(this) and then keeping entirely in cache
        // 2.1 - Deposit if xfer fees
        if(_hasTxFee){
            uint256 deposited = IPlatformIntegration(_integrator).deposit(_bAsset, transferred, true);
            quantityDeposited = StableMath.min(deposited, _quantity);
        }
        // 2.2 - Else Deposit X if Cache > %
        else {
            // This check is in place to ensure that any token with a txFee is rejected
            require(transferred == _quantity, "Asset not fully transferred");

            quantityDeposited = transferred;

            uint256 relativeMaxCache = _maxCache.divRatioPrecisely(_bAssetRatio);

            if(cacheBal > relativeMaxCache){
                uint256 delta = cacheBal.sub(relativeMaxCache.div(2));
                IPlatformIntegration(_integrator).deposit(_bAsset, delta, false);
            }
        }

        ratioedDeposit = quantityDeposited.mulRatioTruncate(_bAssetRatio);
    }

    /***************************************
                SWAP (PUBLIC)
    ****************************************/

    struct SwapArgs {
        address input;
        address output;
        address recipient;
    }

    /**
     * @dev Simply swaps one bAsset for another bAsset or this mAsset at a 1:1 ratio.
     * bAsset <> bAsset swaps will incur a small fee (swapFee()). Swap
     * is valid if it does not result in the input asset exceeding its maximum weight.
     * @param _input        bAsset to deposit
     * @param _output       Asset to receive - either a bAsset or mAsset(this)
     * @param _quantity     Units of input bAsset to swap
     * @param _recipient    Address to credit output asset
     * @return output       Units of output asset returned
     */
    function swap(
        address _input,
        address _output,
        uint256 _quantity,
        address _recipient
    )
        external
        nonReentrant
        returns (uint256 output)
    {
        // Struct created to avoid Stack Too Deep errors. Minor gas cost increase.
        SwapArgs memory args = SwapArgs(_input, _output, _recipient);
        require(args.input != address(0) && args.output != address(0), "Invalid swap asset addresses");
        require(args.input != args.output, "Cannot swap the same asset");
        require(args.recipient != address(0), "Missing recipient address");
        require(_quantity > 0, "Invalid quantity");

        // 1. If the output is this mAsset, just mint
        if(args.output == address(this)){
            return _mintTo(args.input, _quantity, args.recipient);
        }

        // 2. Grab all relevant info from the Manager
        (bool isValid, string memory reason, BassetDetails memory inputDetails, BassetDetails memory outputDetails) =
            basketManager.prepareSwapBassets(args.input, args.output, false);
        require(isValid, reason);

        Cache memory cache = _getCacheDetails();

        // 3. Deposit the input tokens
        (uint256 amountIn, ) =
            _depositTokens(args.input, inputDetails.bAsset.ratio, inputDetails.integrator, inputDetails.bAsset.isTransferFeeCharged, _quantity, cache.maxCache);
        // 3.1. Update the input balance
        basketManager.increaseVaultBalance(inputDetails.index, inputDetails.integrator, amountIn);

        // 4. Validate the swap
        (bool swapValid, string memory swapValidityReason, uint256 swapOutput, bool applySwapFee) =
            forgeValidator.validateSwap(cache.vaultBalanceSum, inputDetails.bAsset, outputDetails.bAsset, amountIn);
        require(swapValid, swapValidityReason);
        require(swapOutput > 0, "Must withdraw something");

        // 5. Settle the swap
        // 5.0. Redeclare recipient to avoid stack depth error
        address recipient = args.recipient;
        // 5.1. Decrease output bal
        Amount memory amt = _withdrawTokens(
            WithdrawArgs({
                quantity: swapOutput,
                bAsset: args.output,
                integrator: outputDetails.integrator,
                feeRate: applySwapFee ? swapFee : 0,
                hasTxFee: outputDetails.bAsset.isTransferFeeCharged,
                recipient: recipient,
                ratio: outputDetails.bAsset.ratio,
                maxCache: cache.maxCache,
                vaultBalance: outputDetails.bAsset.vaultBalance
            })
        );

        basketManager.decreaseVaultBalance(outputDetails.index, outputDetails.integrator, amt.net);

        surplus = cache.surplus.add(amt.scaledFee);

        emit Swapped(msg.sender, args.input, args.output, amt.net, recipient);

        return amt.net;
    }

    /**
     * @dev Determines both if a trade is valid, and the expected fee or output.
     * Swap is valid if it does not result in the input asset exceeding its maximum weight.
     * @param _input        bAsset to deposit
     * @param _output       Asset to receive - bAsset or mAsset(this)
     * @param _quantity     Units of input bAsset to swap
     * @return valid        Bool to signify that swap is current valid
     * @return reason       If swap is invalid, this is the reason
     * @return output       Units of _output asset the trade would return
     */
    function getSwapOutput(
        address _input,
        address _output,
        uint256 _quantity
    )
        external
        view
        returns (bool, string memory, uint256 output)
    {
        require(_input != address(0) && _output != address(0), "Invalid swap asset addresses");
        require(_input != _output, "Cannot swap the same asset");

        bool isMint = _output == address(this);
        uint256 quantity = _quantity;

        // 1. Get relevant asset data
        (bool isValid, string memory reason, BassetDetails memory inputDetails, BassetDetails memory outputDetails) =
            basketManager.prepareSwapBassets(_input, _output, isMint);
        if(!isValid){
            return (false, reason, 0);
        }

        Cache memory cache = _getCacheDetails();

        // 2. check if trade is valid
        // 2.1. If output is mAsset(this), then calculate a simple mint
        if(isMint){
            // Validate mint
            (isValid, reason) = forgeValidator.validateMint(cache.vaultBalanceSum, inputDetails.bAsset, quantity);
            if(!isValid) return (false, reason, 0);
            // Simply cast the quantity to mAsset
            output = quantity.mulRatioTruncate(inputDetails.bAsset.ratio);
            return(true, "", output);
        }
        // 2.2. If a bAsset swap, calculate the validity, output and fee
        else {
            (bool swapValid, string memory swapValidityReason, uint256 swapOutput, bool applySwapFee) =
                forgeValidator.validateSwap(cache.vaultBalanceSum, inputDetails.bAsset, outputDetails.bAsset, quantity);
            if(!swapValid){
                return (false, swapValidityReason, 0);
            }

            // 3. Return output and fee, if any
            if(applySwapFee){
                (, swapOutput) = _calcSwapFee(swapOutput, swapFee);
            }
            return (true, "", swapOutput);
        }
    }


    /***************************************
              REDEMPTION (PUBLIC)
    ****************************************/

    /**
     * @dev Credits the sender with a certain quantity of selected bAsset, in exchange for burning the
     *      relative mAsset quantity from the sender. Sender also incurs a small mAsset fee, if any.
     * @param _bAsset           Address of the bAsset to redeem
     * @param _bAssetQuantity   Units of the bAsset to redeem
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeem(
        address _bAsset,
        uint256 _bAssetQuantity
    )
        external
        nonReentrant
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAsset, _bAssetQuantity, msg.sender);
    }

    /**
     * @dev Credits a recipient with a certain quantity of selected bAsset, in exchange for burning the
     *      relative Masset quantity from the sender. Sender also incurs a small fee, if any.
     * @param _bAsset           Address of the bAsset to redeem
     * @param _bAssetQuantity   Units of the bAsset to redeem
     * @param _recipient        Address to credit with withdrawn bAssets
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeemTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        external
        nonReentrant
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAsset, _bAssetQuantity, _recipient);
    }

    /**
     * @dev Credits a recipient with a certain quantity of selected bAssets, in exchange for burning the
     *      relative Masset quantity from the sender. Sender also incurs a small fee on the outgoing asset.
     * @param _bAssets          Address of the bAssets to redeem
     * @param _bAssetQuantities Units of the bAssets to redeem
     * @param _recipient        Address to credit with withdrawn bAssets
     * @return massetMinted     Relative number of mAsset units burned to pay for the bAssets
     */
    function redeemMulti(
        address[] calldata _bAssets,
        uint256[] calldata _bAssetQuantities,
        address _recipient
    )
        external
        nonReentrant
        returns (uint256 massetRedeemed)
    {
        return _redeemTo(_bAssets, _bAssetQuantities, _recipient);
    }

    /**
     * @dev Credits a recipient with a proportionate amount of bAssets, relative to current vault
     * balance levels and desired mAsset quantity. Burns the mAsset as payment.
     * @param _mAssetQuantity   Quantity of mAsset to redeem
     * @param _recipient        Address to credit the withdrawn bAssets
     */
    function redeemMasset(
        uint256 _mAssetQuantity,
        address _recipient
    )
        external
        nonReentrant
    {
        _redeemMasset(_mAssetQuantity, _recipient);
    }

    /***************************************
              REDEMPTION (INTERNAL)
    ****************************************/

    /** @dev Casting to arrays for use in redeemMulti func */
    function _redeemTo(
        address _bAsset,
        uint256 _bAssetQuantity,
        address _recipient
    )
        internal
        returns (uint256 massetRedeemed)
    {
        address[] memory bAssets = new address[](1);
        uint256[] memory quantities = new uint256[](1);
        bAssets[0] = _bAsset;
        quantities[0] = _bAssetQuantity;
        return _redeemTo(bAssets, quantities, _recipient);
    }

    /** @dev Redeem mAsset for one or more bAssets */
    function _redeemTo(
        address[] memory _bAssets,
        uint256[] memory _bAssetQuantities,
        address _recipient
    )
        internal
        returns (uint256 massetRedeemed)
    {
        require(_recipient != address(0), "Must be a valid recipient");
        uint256 bAssetCount = _bAssetQuantities.length;
        require(bAssetCount > 0 && bAssetCount == _bAssets.length, "Input array mismatch");

        // Prepare relevant data
        RedeemProps memory props = basketManager.prepareRedeemBassets(_bAssets);
        if(!props.isValid) return 0;

        Cache memory cache = _getCacheDetails();

        // Validate redemption
        (bool redemptionValid, string memory reason, bool applyFee) =
            forgeValidator.validateRedemption(false, cache.vaultBalanceSum, props.allBassets, props.indexes, _bAssetQuantities);
        require(redemptionValid, reason);

        uint256 mAssetQuantity = 0;

        // Calc total redeemed mAsset quantity
        for(uint256 i = 0; i < bAssetCount; i++){
            uint256 bAssetQuantity = _bAssetQuantities[i];
            if(bAssetQuantity > 0){
                // Calc equivalent mAsset amount
                uint256 ratioedBasset = bAssetQuantity.mulRatioTruncateCeil(props.bAssets[i].ratio);
                mAssetQuantity = mAssetQuantity.add(ratioedBasset);
            }
        }
        require(mAssetQuantity > 0, "Must redeem some bAssets");

        // Redemption has fee? Fetch the rate
        uint256 fee = applyFee ? swapFee : 0;

        // Apply fees, burn mAsset and return bAsset to recipient
        _settleRedemption(
            RedemptionSettlement({
                recipient: _recipient,
                mAssetQuantity: mAssetQuantity,
                bAssetQuantities: _bAssetQuantities,
                indices: props.indexes,
                integrators: props.integrators,
                feeRate: fee,
                bAssets: props.bAssets,
                cache: cache
            })
        );

        emit Redeemed(msg.sender, _recipient, mAssetQuantity, _bAssets, _bAssetQuantities);
        return mAssetQuantity;
    }


    /** @dev Redeem mAsset for a multiple bAssets */
    function _redeemMasset(
        uint256 _mAssetQuantity,
        address _recipient
    )
        internal
    {
        require(_recipient != address(0), "Must be a valid recipient");
        require(_mAssetQuantity > 0, "Invalid redemption quantity");

        // Fetch high level details
        RedeemPropsMulti memory props = basketManager.prepareRedeemMulti();
        uint256 colRatio = StableMath.min(props.colRatio, StableMath.getFullScale());

        // Ensure payout is related to the collateralised mAsset quantity
        uint256 collateralisedMassetQuantity = _mAssetQuantity.mulTruncate(colRatio);

        // Calculate redemption quantities
        (bool redemptionValid, string memory reason, uint256[] memory bAssetQuantities) =
            forgeValidator.calculateRedemptionMulti(collateralisedMassetQuantity, props.bAssets);
        require(redemptionValid, reason);

        // Apply fees, burn mAsset and return bAsset to recipient
        _settleRedemption(
            RedemptionSettlement({
                recipient: _recipient,
                mAssetQuantity: _mAssetQuantity,
                bAssetQuantities: bAssetQuantities,
                indices: props.indexes,
                integrators: props.integrators,
                feeRate: redemptionFee,
                bAssets: props.bAssets,
                cache: _getCacheDetails()
            })
        );

        emit RedeemedMasset(msg.sender, _recipient, _mAssetQuantity);
    }

    /**
     * @param _recipient        Recipient of the bAssets
     * @param _mAssetQuantity   Total amount of mAsset to burn from sender
     * @param _bAssetQuantities Array of bAsset quantities
     * @param _indices          Matching indices for the bAsset array
     * @param _integrators      Matching integrators for the bAsset array
     * @param _feeRate          Fee rate to be applied to this redemption
     * @param _bAssets          Array of bAssets to redeem
     */
    struct RedemptionSettlement {
        address recipient;
        uint256 mAssetQuantity;
        uint256[] bAssetQuantities;
        uint8[] indices;
        address[] integrators;
        uint256 feeRate;
        Basset[] bAssets;
        Cache cache;
    }

    /**
     * @dev Internal func to update contract state post-redemption,
     * burning sufficient mAsset before withdrawing all tokens
     */
    function _settleRedemption(
        RedemptionSettlement memory args
    ) internal {
        // 1.0. Burn the full amount of Masset
        _burn(msg.sender, args.mAssetQuantity);

        // 2.0. Transfer the Bassets to the recipient and count fees
        uint256 bAssetCount = args.bAssets.length;
        uint256[] memory netAmounts = new uint256[](bAssetCount);
        uint256 fees = 0;
        for(uint256 i = 0; i < bAssetCount; i++){
            Amount memory amt = _withdrawTokens(
                WithdrawArgs({
                    quantity: args.bAssetQuantities[i],
                    bAsset: args.bAssets[i].addr,
                    integrator: args.integrators[i],
                    feeRate: args.feeRate,
                    hasTxFee: args.bAssets[i].isTransferFeeCharged,
                    recipient: args.recipient,
                    ratio: args.bAssets[i].ratio,
                    maxCache: args.cache.maxCache,
                    vaultBalance: args.bAssets[i].vaultBalance
                })
            );
            // 2.1. Log the net amounts (output - fee)
            netAmounts[i] = amt.net;
            // 2.2. Accumulate scaled fees
            fees = fees.add(amt.scaledFee);
        }
        // 2.3. Log the collected fees to the surplus
        surplus = args.cache.surplus.add(fees);

        // 3.0. Reduce the vaultBalances by the **net** amount
        basketManager.decreaseVaultBalances(args.indices, args.integrators, netAmounts);
    }

    struct WithdrawArgs {
        uint256 quantity;
        address bAsset;
        address integrator;
        uint256 feeRate;
        bool hasTxFee;
        address recipient;
        uint256 ratio;
        uint256 maxCache;
        uint256 vaultBalance;
    }

    /**
     * @dev Withdraws a given asset from its platformIntegration. If there is sufficient liquidity
     * in the cache, then withdraw from there, otherwise withdraw from the lending market and reset the
     * cache to the mid level.
     * @param args     All args needed for a full withdrawal
     * @return amount  Struct containing the desired output, output-fee, and the scaled fee
     */
    function _withdrawTokens(WithdrawArgs memory args) internal returns (Amount memory amount) {
        if(args.quantity > 0){

            // 1. Deduct the redemption fee, if any, and log quantities
            amount = _deductSwapFee(args.bAsset, args.quantity, args.feeRate, args.ratio);

            // 2. If txFee then short circuit - there is no cache
            if(args.hasTxFee){
                IPlatformIntegration(args.integrator).withdraw(args.recipient, args.bAsset, amount.net, amount.net, true);
            }
            // 3. Else, withdraw from either cache or main vault
            else {
                uint256 cacheBal = IERC20(args.bAsset).balanceOf(args.integrator);
                // 3.1 - If balance b in cache, simply withdraw
                if(cacheBal >= amount.net) {
                    IPlatformIntegration(args.integrator).withdrawRaw(args.recipient, args.bAsset, amount.net);
                }
                // 3.2 - Else reset the cache to X, or as far as possible
                //       - Withdraw X+b from platform
                //       - Send b to user
                else {
                    uint256 relativeMidCache = args.maxCache.divRatioPrecisely(args.ratio).div(2);
                    uint256 totalWithdrawal = StableMath.min(relativeMidCache.add(amount.net).sub(cacheBal), args.vaultBalance.sub(cacheBal));

                    IPlatformIntegration(args.integrator).withdraw(
                        args.recipient,
                        args.bAsset,
                        amount.net,
                        totalWithdrawal,
                        false
                    );
                }
            }
        }
    }


    /***************************************
                    INTERNAL
    ****************************************/

    struct Amount {
        uint256 gross;
        uint256 net;
        uint256 scaledFee;
    }

    /**
     * @dev Calculates the output amount from a given bAsset quantity and fee, and returns in a helpful struct
     * @param _asset            Asset upon which the fee is being deducted
     * @param _bAssetQuantity   Exact amount of the bAsset
     * @param _feeRate          Percentage fee rate
     * @param _ratio            bAsset ratio, to calculate the scaled fee
     * @return struct containing input, input-fee, and a scaled fee
     */
    function _deductSwapFee(address _asset, uint256 _bAssetQuantity, uint256 _feeRate, uint256 _ratio)
        private
        returns (Amount memory)
    {
        if(_feeRate > 0){
            (uint256 fee, uint256 output) = _calcSwapFee(_bAssetQuantity, _feeRate);

            emit PaidFee(msg.sender, _asset, fee);

            return Amount(_bAssetQuantity, output, fee.mulRatioTruncate(_ratio));
        }
        return Amount(_bAssetQuantity, _bAssetQuantity, 0);
    }

    /**
     * @dev Calculates the output amount from a given bAsset quantity and fee
     * @param _bAssetQuantity   Exact amount of bAsset being swapped out
     * @param _feeRate          Percentage rate of fee
     * @return feeAmount        Fee in output asset units
     * @return outputMinusFee   Input minus fee
     */
    function _calcSwapFee(uint256 _bAssetQuantity, uint256 _feeRate)
        private
        pure
        returns (uint256 feeAmount, uint256 outputMinusFee)
    {
        // e.g. for 500 massets.
        // feeRate == 1% == 1e16. _quantity == 5e20.
        // (5e20 * 1e16) / 1e18 = 5e18
        feeAmount = _bAssetQuantity.mulTruncate(_feeRate);
        outputMinusFee = _bAssetQuantity.sub(feeAmount);
    }

    /**
     * vaultBalanceSum = totalSupply + 'surplus'
     * maxCache = vaultBalanceSum * (cacheSize / 1e18)
     * surplus is simply surplus, to reduce SLOADs
     */
    struct Cache {
        uint256 vaultBalanceSum;
        uint256 maxCache;
        uint256 surplus;
    }

    /**
     * @dev Gets the supply and cache details for the mAsset, taking into account the surplus
     * @return Cache containing (tracked) sum of vault balances, ideal cache size and surplus
     */
    function _getCacheDetails() internal view returns (Cache memory) {
        uint256 _surplus = surplus;
        uint256 sum = totalSupply().add(_surplus);
        return Cache(sum, sum.mulTruncate(cacheSize), _surplus);
    }

    /***************************************
                    STATE
    ****************************************/

    /**
      * @dev Sets the MAX cache size for each bAsset. The cache will actually revolve around
      *      _cacheSize * totalSupply / 2 under normal circumstances.
      * @param _cacheSize Maximum percent of total mAsset supply to hold for each bAsset
      */
    function setCacheSize(uint256 _cacheSize)
        external
        onlyGovernance
    {
        require(_cacheSize <= 2e17, "Must be <= 20%");

        cacheSize = _cacheSize;

        emit CacheSizeChanged(_cacheSize);
    }


    /**
      * @dev Upgrades the version of ForgeValidator protocol. Governor can do this
      *      only while ForgeValidator is unlocked.
      * @param _newForgeValidator Address of the new ForgeValidator
      */
    function upgradeForgeValidator(address _newForgeValidator)
        external
        onlyGovernor
    {
        require(!forgeValidatorLocked, "Must be allowed to upgrade");
        require(_newForgeValidator != address(0), "Must be non null address");
        forgeValidator = IForgeValidator(_newForgeValidator);
        emit ForgeValidatorChanged(_newForgeValidator);
    }

    /**
      * @dev Locks the ForgeValidator into it's final form. Called by Governor
      */
    function lockForgeValidator()
        external
        onlyGovernor
    {
        forgeValidatorLocked = true;
    }

    /**
      * @dev Set the ecosystem fee for redeeming a mAsset
      * @param _swapFee Fee calculated in (%/100 * 1e18)
      */
    function setSwapFee(uint256 _swapFee)
        external
        onlyGovernor
    {
        require(_swapFee <= MAX_FEE, "Rate must be within bounds");
        swapFee = _swapFee;

        emit SwapFeeChanged(_swapFee);
    }

    /**
      * @dev Set the ecosystem fee for redeeming a mAsset
      * @param _redemptionFee Fee calculated in (%/100 * 1e18)
      */
    function setRedemptionFee(uint256 _redemptionFee)
        external
        onlyGovernor
    {
        require(_redemptionFee <= MAX_FEE, "Rate must be within bounds");
        redemptionFee = _redemptionFee;

        emit RedemptionFeeChanged(_redemptionFee);
    }

    /**
      * @dev Gets the address of the BasketManager for this mAsset
      * @return basketManager Address
      */
    function getBasketManager()
        external
        view
        returns (address)
    {
        return address(basketManager);
    }

    /***************************************
                    INFLATION
    ****************************************/

    /**
     * @dev Converts recently accrued swap fees into mAsset
     * @return swapFeesGained        Equivalent amount of mAsset units that have been generated
     * @return newSupply             New total mAsset supply
     */
    function collectInterest()
        external
        onlySavingsManager
        nonReentrant
        returns (uint256 swapFeesGained, uint256 newSupply)
    {
        uint256 toMint = 0;
        // Set the surplus variable to 1 to optimise for SSTORE costs.
        // If setting to 0 here, it would save 5k per savings deposit, but cost 20k for the
        // first surplus call (a SWAP or REDEEM).
        if(surplus > 1){
            toMint = surplus.sub(1);
            surplus = 1;

            // mint new mAsset to savings manager
            _mint(msg.sender, toMint);
            emit MintedMulti(address(this), address(this), toMint, new address[](0), new uint256[](0));
        }

        return (toMint, totalSupply());
    }

    /**
     * @dev Collects the interest generated from the Basket, minting a relative
     *      amount of mAsset and sending it over to the SavingsManager.
     * @return interestGained   Lending market interest collected
     * @return newSupply             New total mAsset supply
     */
    function collectPlatformInterest()
        external
        onlySavingsManager
        nonReentrant
        returns (uint256 interestGained, uint256 newSupply)
    {
        // 1. Collect interest from Basket
        (uint256 interestCollected, uint256[] memory gains) = basketManager.collectInterest();

        // 2. Mint to SM
        _mint(msg.sender, interestCollected);
        emit MintedMulti(address(this), address(this), interestCollected, new address[](0), gains);

        return (interestCollected, totalSupply());
    }
}
