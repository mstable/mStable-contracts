pragma solidity ^0.5.12;
pragma experimental ABIEncoderV2;
/* solium-disable security/no-block-members */

import { IRecollateraliser } from "../interfaces/IRecollateraliser.sol";

import { RecollateraliserModule, IManager, ISystok } from "./RecollateraliserModule.sol";

import { ReentrancyGuard } from "../shared/ReentrancyGuard.sol";
import { StableMath } from "../shared/math/StableMath.sol";

/**
 * @dev Basic interface for ERC20
 */
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function burn(uint256 amount) external;
    function mint(address account, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/**
 * @title Recollateraliser
 * @author Stability Labs Pty. Ltd.
 * @notice Serves as the ultimate protection mechanism for a Masset which contains a failed Basset
 * @dev This failed Basset is auctioned off here using an OpenIPO version of a Dutch
 *      auction in return for the Masset which is then burnt. The resulting delta between
 *      raised/target Massets is then filled by auctioning off newly minted system token, Meta.
 *
 *
 *  TODO (recol) - I suspect we can simplify some of the maths by combining the bassetRatio and the bassetPrice
 *  Which would save a few lines here and there. However, i think it reduces mental complexity as is.
 *  Regardless, these calculations need to be air tight.
 *
 */
contract Recollateraliser is
    IRecollateraliser,
    ReentrancyGuard,
    RecollateraliserModule
{

    /** @dev Used throughout for Masset calcs */
    using StableMath for uint256;


    /** @dev Core auction struct to track whole auction state */
    struct Auction {

        address masset;             // Address of the Masset
        uint256 massetsToBurn;      // Units of Masset still left to burn

        AuctionStage stage;         // Stage of the Auction

        address basset;             // address of the basset to sell
        uint256 bassetRatio;        // bassetQ * bassetRatio = massetQ
        uint256 bassetsForSale;     // total bassets to sell
        uint256 bassetStartPrice;   // starting ratio between masset:basset where 1:1 == 1e18

        address systok;             // Address of the Systok token
        uint256 systokStartPrice;   // starting ratio between masset:systok where 15:1 == 15e18
        uint256 systokReservePrice; // starting ratio between masset:systok where 3:1 == 3e18

        SubAuction bassetAuction;
        SubAuction metaAuction;

    }

    /** @dev Basic stages to an auction */
    enum AuctionStage {
        None,
        BassetPhase,
        MetaPhase,
        Complete,
        Failed
    }

    /** @dev All details specific to the Basset Phase */
    struct SubAuction {
        uint128  start;              // When this phase begins (ms)
        uint128  scaledDuration;     // Duration of the auction phase (time in ms * 1e18)
        uint64   end;                // When will the auction end (ms)
        uint256  massetsCommitted;   // Track the total masset commitment in this phase
        uint256  finalRatio;         // Final ratio, used for paying out trade
        // Tracking traders committment to purchasing Bassets
        mapping(address => Commitment) commitments;
        address[] committers;
    }

    /** @dev A trader makes a commitment in the form of a quantity of Masset (1 == 1e18) */
    struct Commitment {
        uint256 quantity;
        bool claimed;
    }


    /** @dev Track all auctions */
    mapping (uint256 => Auction) private auctions;
    mapping (address => uint256) private bassetToAuction;
    uint256 private auctionCount = 0;

    /** @dev Generic timings to pass to each auction */
    uint256  private auctionDelay = 30 minutes;
    uint256  private auctionDuration = 2 days;

    /** @dev Generic pricing strategy to use during the auction */
    uint256 private bassetStartPrice = 12e17;   // 1.2:1 Masset:(Basset*ratio)
    uint256 private metaStartWeight = 15e17;    // 100% == 1e18
    uint256 private metaReserveWeight = 75e16;  // 100% == 1e18


    /** @dev Basic constructor */
    constructor(
        address _nexus,
        address _manager,
        address _systok
    )
        RecollateraliserModule(_nexus)
        public
    {
        manager = IManager(_manager);
        systok = ISystok(_systok);
    }

    /** @dev Validates that the auction exists by checking non null stage */
    modifier auctionExists(uint256 _auctionId) {
        require(auctions[_auctionId].stage != AuctionStage.None, "Auction must exist");
        _;
    }

    /** @dev Validates that the auction is active, in either Basset or Meta auctions */
    modifier auctionIsActive(uint256 _auctionId) {
        require(auctions[_auctionId].stage == AuctionStage.BassetPhase || auctions[_auctionId].stage == AuctionStage.MetaPhase,
            "Auction must be active");
        _;
    }

    /** @dev Validates that the auction is in a particular stage */
    modifier auctionIsInStage(uint256 _auctionId, AuctionStage _stage) {
        require(auctions[_auctionId].stage == _stage,
            "Auction must be active");
        _;
    }

    /*************************************
    ******    INITIALISE AUCTION    ******
    *************************************/


    /**
     *  @dev Begin the auction process - recollateralise this Basset
     *  @param _masset      Address of the Masset to collect and burn
     *  @param _basset      Address of the Basset to sell
     *  @param _bassetUnits Quantity of Basset units available
     *  @param _bassetRatio Basset base unit * ratio = Masset base
     *  @param _massetPrice Masset price where $1 == 1e18
     *  @param _metaPrice   Meta price where $1 == 1e18
     *  @return             Auction ID
     */
    function recollateraliseBasset(
        address _masset,
        address _basset,
        uint256 _bassetUnits,
        uint256 _bassetRatio,
        uint256 _massetPrice,
        uint256 _metaPrice
    )
        public
        onlyModule(Key_Manager)
        returns (uint auctionId)
    {
        // Basic param checks
        require(_masset != address(0) && _basset != address(0), "Must be valid tokens");
        require(_bassetUnits > 0, "Must sell > 0");
        require(_bassetRatio > 0, "Must have ratio");
        require(bassetToAuction[_basset] == 0, "No active auction must exist");
        require(IERC20(_basset).transferFrom(_masset, address(this), _bassetUnits), "Must hold Bassets");

        auctionId = ++auctionCount;

        Auction storage auction_ = auctions[auctionId];
        auction_.masset = _masset;
        auction_.massetsToBurn = _bassetUnits.mulRatioTruncateCeil(_bassetRatio);

        auction_.stage = AuctionStage.BassetPhase;

        auction_.basset = _basset;
        auction_.bassetRatio = _bassetRatio;
        auction_.bassetsForSale = _bassetUnits;
        auction_.bassetStartPrice = bassetStartPrice;

        _startSubAuction(auction_.bassetAuction);

        auction_.systok = address(systok);
        // Get the current systok:masset ratio using the governor validated prices
        uint256 systokToMassetRatio = _metaPrice.divPrecisely(_massetPrice);
        auction_.systokStartPrice = systokToMassetRatio.mulTruncate(metaStartWeight);
        auction_.systokReservePrice = systokToMassetRatio.mulTruncate(metaReserveWeight);

        bassetToAuction[_basset] = auctionId;

        // Auction begins in 30 mins.
    }


    /*************************************
    ******         PLACE BID        ******
    *************************************/


    /**
     *  @dev A trader commits to spend a particular quantity of Massets in the auction
     *  @param _auctionId      ID of the auction
     *  @param _massetQuantity Quantity of Masset to commit
     *  @param _requiredStage  Required stage
     *  @param _timeLimit      Time of trade must be before limit, should a user wish to block
     *  @return Amount of Massets committed (may have been clamped)
     */
    function commit(
        uint256 _auctionId,
        uint256 _massetQuantity,
        AuctionStage _requiredStage,
        uint256 _timeLimit
    )
        external
        auctionIsInStage(_auctionId, _requiredStage)
        returns(uint256 massetsCommitted)
    {
        require(_massetQuantity > 0, "Must be committing Massets");

        Auction memory auction = auctions[_auctionId];

        // Get current auction details
        SubAuction storage auctionDetails_ = auction.stage == AuctionStage.BassetPhase
            ? auctions[_auctionId].bassetAuction
            : auctions[_auctionId].metaAuction;

        require(block.timestamp >= auctionDetails_.start, "Auction must have begun");

        if(block.timestamp > auctionDetails_.end){
          _resolveAuctionState(_auctionId);
          return 0;
        }

        require(block.timestamp < _timeLimit, "Must not surpass trade limit");

        uint256 clampedCommitment;

        if(auction.stage == AuctionStage.BassetPhase){
            clampedCommitment = _clampCommitmentForBassets(auction, _massetQuantity);
        } else {
            // Clamp the commitment to the remaining available Massets
            clampedCommitment = _massetQuantity.clamp(auction.massetsToBurn.sub(auctionDetails_.massetsCommitted));
        }

        _commitMassetsToAuction(auction.masset, auctionDetails_, clampedCommitment);

        // If the bid has been clamped, settle the state
        if(clampedCommitment < _massetQuantity){
            _resolveAuctionState(_auctionId);
        }

        return clampedCommitment;
    }

    /**
     *  @dev Internal func to execute commitment and send the Massets to the sub auction
     *  @param _masset            Address of the Masset to collect and burn
     *  @param auction_           Storage object for the Sub Auction to commit to
     *  @param _clampedCommitment Quantity of Massets to commit
     */
    function _commitMassetsToAuction(
        address _masset,
        SubAuction storage auction_,
        uint256 _clampedCommitment
    )
        internal
    {
        if(_clampedCommitment > 0){
            // Transfer the tokens to this account
            require(IERC20(_masset).transferFrom(msg.sender, address(this), _clampedCommitment), "Must transfer tokens");

            // Fetch any previous commitment the trader may have made
            uint256 previousCommitment = auction_.commitments[msg.sender].quantity;

            // Update the traders total commitment and add them to array if necessary
            auction_.commitments[msg.sender].quantity = previousCommitment.add(_clampedCommitment);
            if(previousCommitment == 0){
                auction_.committers.push(msg.sender);
            }

            // Update total phase amount
            auction_.massetsCommitted += _clampedCommitment;
        }
    }


    /**
     *  @dev Calculates whether a Masset commitment during this Basset stage will
     *  make us oversold. If so, clamp to the max available Bassets.
     *  @param _auction         Auction in question
     *  @param _massetQuantity  Quantity of proposed Masset commmitment where 1==1e18
     *  @return _clampedCommitment, the maximum available commitment
     */
    function _clampCommitmentForBassets(
        Auction memory _auction,
        uint256 _massetQuantity
    )
        internal
        view
        returns (uint256 _clampedCommitment)
    {
        _clampedCommitment = _massetQuantity;
        SubAuction memory auctionDetails = _auction.bassetAuction;

        // Find out current price (where 0.8:1 Massets:Bassets == 8e17)
        uint256 currentPrice = _getCurrentPrice(_auction.bassetStartPrice, 1, auctionDetails.scaledDuration, auctionDetails.end);

        // Calc how many bassets sold already (massets / currentPrice)
        // e.g. 1.2:1 means depositing 1.2 massets gives 1 basset
        // sold = massetsCommitted/ratio (2000e18/1.2) = 1666 bassets sold
        uint256 currentBassetsSold = auctionDetails.massetsCommitted.divPrecisely(currentPrice);

        // if oversold based on elapsed time, just skip straight to settling phase
        // uint256 bassetsForSaleScaled = _auction.bassetsForSale.mulRatioTruncate(_auction.bassetRatio);
        uint256 bassetsForSaleScaled = _auction.massetsToBurn;

        if(currentBassetsSold >= bassetsForSaleScaled){
            _clampedCommitment = 0;
        } else {
            // Calculate clamped bid
            uint256 postTradeBassetsSold = (auctionDetails.massetsCommitted.add(_massetQuantity)).divPrecisely(currentPrice);
            if(postTradeBassetsSold > bassetsForSaleScaled){
                // Calculate max bid (rounded up)
                // max commitment (at this price) = bassetsForSale * currentPrice. e.g. trunc(15000e18 * 5e17) = 7500e18 massets
                uint256 maxCommitment = bassetsForSaleScaled.mulTruncateCeil(currentPrice);
                // Clamped commitment = maxCommitment - currentCommitment
                _clampedCommitment = maxCommitment.sub(auctionDetails.massetsCommitted);
            }
        }
    }



    /*************************************
    ******       SETTLE TRADE       ******
    *************************************/

    /**
     *  @dev Resolves a traders (msg.sender) commitment by settling the trade and paying out
     *  the corresponding reward, based on the finalRatio of the specified sub auction.
     *  @param _auctionId       ID of the auction to settle
     *  @param _phaseToSettle   Either BassetPhase or MetaPhase, to settle
     *  @return base units of the settlement token paid out to the trader
     */
    function settleTrade(
        uint256 _auctionId,
        AuctionStage _phaseToSettle
    )
        external
        auctionExists(_auctionId)
        nonReentrant
        returns (uint256 payout)
    {
        Auction memory auction = auctions[_auctionId];
        AuctionStage stage = auction.stage;

        // Basset trade settlement
        if(_phaseToSettle == AuctionStage.BassetPhase){
            require(stage == AuctionStage.MetaPhase || stage == AuctionStage.Complete || stage == AuctionStage.Failed, "Invalid auction state");
            // check for Basset trade and settle
            Commitment storage commitment_ = auctions[_auctionId].bassetAuction.commitments[msg.sender];
            require(commitment_.quantity > 0 && !commitment_.claimed, "Claimed or empty commitment");
            // Trade has been claimed
            commitment_.claimed = true;
            // Now we need to pay out.. so.. calc how much we owe
            // massetsCommited / finalRatio e.g. 1000e18 / 3e17 = 3333.3..e18
            uint256 scaledPayout = commitment_.quantity.divPrecisely(auction.bassetAuction.finalRatio);
            // Payout = scaledPayout / ratio
            payout = scaledPayout.divRatioPrecisely(auction.bassetRatio);
            require(IERC20(auction.basset).transfer(msg.sender, payout), "Must transfer tokens");
        }
        // Meta trade settlement
        else if(_phaseToSettle == AuctionStage.MetaPhase) {
            Commitment storage commitment_ = auctions[_auctionId].metaAuction.commitments[msg.sender];
            require(commitment_.quantity > 0 && !commitment_.claimed, "Claimed or empty commitment");
            // If the auction Completed, calc Meta payout based on final ratio
            if(stage == AuctionStage.Complete){
                commitment_.claimed = true;
                payout = commitment_.quantity.divPrecisely(auction.metaAuction.finalRatio);
                require(IERC20(auction.systok).transfer(msg.sender, payout), "Must transfer tokens");
            }
            // If the auction Failed, just return the commitment
            else if(stage == AuctionStage.Failed) {
                commitment_.claimed = true;
                require(IERC20(auction.masset).transfer(msg.sender, commitment_.quantity), "Must transfer tokens");
            }
        }
    }


    /*************************************
    ******       CALCULATIONS       ******
    *************************************/

    /**
     *  @dev Scales a price linearly from start price to end price, based on auction progress
     *  @param _startingPrice   Starting price for the auction, where 20:1 Masset:X == 20e18
     *  @param _endPrice        Reserve price for the auction (logically should be min 1)
     *  @param _scaledDuration  Duration of the auction in ms*1e18, to allow for precise ratio
     *  @param _end             End time of the auction, to allow us to calc ms remaining
     *  @return base units of the settlement token paid out to the trader
     */
    function _getCurrentPrice(
        uint256 _startingPrice,
        uint256 _endPrice,
        uint256 _scaledDuration,
        uint64 _end
    )
        internal
        view
        returns (uint256)
    {
        // 1. Calc timeLeft = ms remaining
        uint64 currentTime = uint64(block.timestamp);

        // If time has elapsed, then just return base price
        if(currentTime > _end){
            return _endPrice;
        }
        // Else calc timeLeft
        uint256 timeLeft = uint256(StableMath.sub64(_end, currentTime));

        // 2. Scale time left for use in ratio calc
        uint256 scaledTimeLeft = timeLeft.scale();

        // 3. TimeRatio = timeleft / duration (where start = 1e18 && end = 0)
        uint256 timeRatio = scaledTimeLeft.divPrecisely(_scaledDuration);

        // 4. Calc price subject to scale. scaledPrice = ((start-endPrice)*ratio)
        uint256 priceSubjectToScale = _startingPrice.sub(_endPrice);
        uint256 scaledPrice = priceSubjectToScale.mulTruncate(timeRatio);

        // 5. Current price = endPrice + scaledPrice
        // This is current masset:basset/meta ratio
        return scaledPrice.add(_endPrice);
    }



    /*************************************
    ******       RESOLVE STATE      ******
    *************************************/

    /**
     *  @dev Public func to progress the state of the auction, necessary backup for inactive auctions
     *  @param _auctionId   ID of the auction to resolve
     */
    function resolveAuctionState(
        uint256 _auctionId
    )
        external
        auctionIsActive(_auctionId)
    {
        _resolveAuctionState(_auctionId);
    }

    /**
     *  @dev Progresses the state of the auction and takes subsequent system action, calculating the
     *  final price ratios and burning/minting relevant tokens.
     *  The end of the BassetPhase is identified as having sold all the Bassets, or running out of time
     *  The end of the MetaPhase is identified as having collected enough Masset commitments
     *  , if we ran out of time the auction is Failed.
     *  @param _auctionId   ID of the auction to resolve
     */
    function _resolveAuctionState(
        uint256 _auctionId
    )
        internal
        nonReentrant
    {
        // Require this, require that
        Auction memory auction = auctions[_auctionId];

        // Currently in BassetPhase?
        if(auction.stage == AuctionStage.BassetPhase) {
            // Get current auction details
            SubAuction storage auctionDetails_ = auctions[_auctionId].bassetAuction;
            // Find out current price (where 0.8:1 Massets:Bassets == 8e17)
            uint256 currentPrice = _getCurrentPrice(auction.bassetStartPrice, 1, auctionDetails_.scaledDuration, auctionDetails_.end);
            // Calc how many bassets sold already (massets / currentPrice)
            uint256 currentBassetUnitsSold = auctionDetails_.massetsCommitted.divPrecisely(currentPrice);
            // Figure out how many Basset units need to be sold
            // uint256 bassetsForSaleScaled = auction.bassetsForSale.mulRatioTruncate(auction.bassetRatio);
            uint256 bassetsForSaleScaled = auction.massetsToBurn;

            // 1. If we have reached the quota (committed*ratio > bassetsForSale), then resolve
            // 2. If we have ran out of time, this means we collected ~0 massets
            // (as each base unit collected corresponds to 1 whole (1e18) basset unit in the end)
            if(currentBassetUnitsSold >= bassetsForSaleScaled || block.timestamp > auctionDetails_.end) {
                // update stage
                auctions[_auctionId].stage = AuctionStage.MetaPhase;
                // set meta start time / params
                _startSubAuction(auctions[_auctionId].metaAuction);
                // If we received any Massets then..
                if(auctionDetails_.massetsCommitted > 0) {
                    // Set auctionDetails.finalRatio = currentPrice
                    auctionDetails_.finalRatio = currentPrice;
                    // Burn the massets
                    IERC20(auction.masset).burn(auctionDetails_.massetsCommitted);
                    // setMassetsToBurn
                    auctions[_auctionId].massetsToBurn = auctions[_auctionId].massetsToBurn.sub(auctionDetails_.massetsCommitted);
                }
            }

        } else if(auction.stage == AuctionStage.MetaPhase) {
            // Get current auction details
            SubAuction storage auctionDetails_ = auctions[_auctionId].metaAuction;

            // 1. If massetsCommitted >= massetsToBurn then the auction is complete
            if(auctionDetails_.massetsCommitted >= auction.massetsToBurn){
                // Calculate and lock the finalRatio
                // Find out current price (where 35:1 Massets:Systok == 35e17)
                uint256 currentPrice = _getCurrentPrice(auction.systokStartPrice, auction.systokReservePrice, auctionDetails_.scaledDuration, auctionDetails_.end);
                auctionDetails_.finalRatio = currentPrice;
                // Burn the Massets
                IERC20(auction.masset).burn(auctionDetails_.massetsCommitted);
                // Calc and mint Systok Payout (payout = commitment/price) e.g. 15000e18 / 6e18 = 2500e18
                uint256 totalSystokPayout = auctionDetails_.massetsCommitted.divPrecisely(currentPrice);
                require(IERC20(auction.systok).mint(address(this), totalSystokPayout), "Must mint systok");
                // Set stage == Complete && massetsToBurn
                auctions[_auctionId].stage = AuctionStage.Complete;
                auctions[_auctionId].massetsToBurn = 0;
                // Call MassetManager to complete recollateralisation (stub)
                manager.completeRecol(auction.masset, auction.basset, 0);
            }
            // 2. If we didnt raise enough Massets in time, then the auction has failed
            else if(block.timestamp > auctionDetails_.end) {
                // Set stage == Failed
                auctions[_auctionId].stage = AuctionStage.Failed;
                // Call MassetManager with failed reocol (stub)
                manager.completeRecol(auction.masset, auction.basset, auction.massetsToBurn);
            }
        }
    }

    /**
     *  @dev Sets the params on a new SubAuction stage, identifying the time, duration and end
     *  @param subAuction_  Storage reference to the struct needing instantiated
     */
    function _startSubAuction(
        SubAuction storage subAuction_
    )
        internal
    {
        uint256 currentTime = block.timestamp;
        subAuction_.start = uint128(currentTime.add(auctionDelay));
        subAuction_.scaledDuration = uint128(auctionDuration.scale());
        subAuction_.end = uint64(currentTime.add(auctionDuration));
    }


    /*************************************
    ******          GETTERS         ******
    *************************************/


    /**
     *  @dev Gets the relevant auction from storage
     */
    function getAuction(
        uint256 _auctionId
    )
        external
        view
        auctionExists(_auctionId)
        returns(
            address masset,
            uint256 massetsToBurn,
            AuctionStage stage,
            address basset,
            uint256 bassetRatio,
            uint256 bassetsForSale,
            uint256 bassetStartingPrice,
            uint256 systokStartPrice,
            uint256 systokReservePrice
        )
    {
        Auction memory auction = auctions[_auctionId];
        return (
          auction.masset,
          auction.massetsToBurn,
          auction.stage,
          auction.basset,
          auction.bassetRatio,
          auction.bassetsForSale,
          auction.bassetStartPrice,
          auction.systokStartPrice,
          auction.systokReservePrice
        );
    }

    /**
     *  @dev Gets the sub auction details from storage
     */
    function getSubAuction(
        uint256 _auctionId,
        AuctionStage _phase
    )
        external
        view
        auctionExists(_auctionId)
        returns(
            uint128  start,
            uint128  scaledDuration,
            uint64   end,
            uint256  massetsCommitted,
            uint256  finalRatio,
            address[] memory committers
        )
    {
        SubAuction memory subAuction = _phase == AuctionStage.BassetPhase
            ? auctions[_auctionId].bassetAuction
            : auctions[_auctionId].metaAuction;
        return (
          subAuction.start,
          subAuction.scaledDuration,
          subAuction.end,
          subAuction.massetsCommitted,
          subAuction.finalRatio,
          subAuction.committers
        );
    }

    /**
     *  @dev Gets a traders commitment from storage
     */
    function getCommitment(
        uint256 _auctionId,
        AuctionStage _phase,
        address _trader
    )
        external
        view
        auctionExists(_auctionId)
        returns(
            uint256 quantity,
            bool claimed
        )
    {
        Commitment memory commitment = _phase == AuctionStage.BassetPhase
            ? auctions[_auctionId].bassetAuction.commitments[_trader]
            : auctions[_auctionId].metaAuction.commitments[_trader];
        return (
          commitment.quantity,
          commitment.claimed
        );
    }

}