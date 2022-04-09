// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { ISavingsContractV3 } from "../interfaces/ISavingsContract.sol";
import "../interfaces/ITokenLocker.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Counters.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import { StableMath } from "../shared/StableMath.sol";

/// @title TokenLocker Contract utilizing mStable's SavingsContract
/// @author mStable-Test
/// @notice TokenLocker Contract allows user to lock underlying collateral for interest bearing NFTs
contract TokenLocker is
    ITokenLocker,
    ERC721,
    ERC721Enumerable,
    ERC721Burnable,
    Ownable,
    ReentrancyGuard
{
    using StableMath for uint256;

    // Core events for deposit and withdraw
    event Deposit(address indexed user, uint256 indexed lockerId, uint256 amount);
    event Withdraw(address indexed user, uint256 lockerId, uint256 creditsRedeemed, uint256 payout);
    // Batch Execute Event
    event BatchCleared(
        address indexed clearer,
        uint256 collateralDeposited,
        uint256 creditsReceived
    );
    // Fire this event when Batch volume is reached
    event BatchIt(uint256 toBeBatchedCollateral);

    using Counters for Counters.Counter;
    // To keep track of lockerId which is same as NFT tokenId
    Counters.Counter private _lockerIdCounter;

    // Savings Contract for the Locker
    ISavingsContractV3 public immutable savingsContract;
    // Lock period
    uint256 private immutable lockPeriod;
    // Batching Threshold
    uint256 public immutable batchingThreshold;

    // mAsset collateral of locker
    mapping(uint256 => uint256) public lockerCollateral;
    // imCredits of the locker
    mapping(uint256 => uint256) public lockerCredits;
    // maturityTime of locker
    mapping(uint256 => uint256) public lockerMaturity;

    // Last Locker Id to be included in BatchExecute
    uint256 public lastBatchedLockerId;
    // Last time batchExecute was called
    uint256 public lastBatchedTime;
    // Total Collateral to be deposited to
    uint256 public toBeBatchedCollateral;

    // Total collateral deposited by users
    // For internal calculation basis just in case anyone can force send the collateral
    // and invalidate invariants
    uint256 public totalCollateral;

    constructor(
        string memory _name,
        string memory _symbol,
        address _savingsContract,
        uint256 _lockPeriod,
        uint256 _batchingThreshold
    ) ERC721(_name, _symbol) {
        savingsContract = ISavingsContractV3(_savingsContract);
        lockPeriod = _lockPeriod;
        batchingThreshold = _batchingThreshold;
    }

    // Is msg.sender Locker Owner
    modifier isLockerOwner(uint256 _lockerId) {
        require(ownerOf(_lockerId) == msg.sender, "Must Own Locker");
        _;
    }

    // Is Locker Matured for withdraw
    modifier isLockerMatured(uint256 _lockerId) {
        require(lockerMaturity[_lockerId] < block.timestamp, "Locker not matured");
        _;
    }

    /// @notice lock mAsset amount and mint interest bearing NFT
    /// @dev tracking tobeBatchedCollateral in here to emit actionalble events
    /// @param _amount Amount of mAsset to lock
    function lock(uint256 _amount) external override {
        // Transfer the mAssest to this contract
        require(
            getMAsset().transferFrom(msg.sender, address(this), _amount),
            "Must receive tokens"
        );

        // Create new Locker
        uint256 lockerId = _lockerIdCounter.current();
        // Set Locker Collateral
        lockerCollateral[lockerId] = _amount;
        // Set Locker Maturity Date
        lockerMaturity[lockerId] = block.timestamp + lockPeriod;
        // Increment Total outstanding collateral that is to be batched
        toBeBatchedCollateral += _amount;
        // Increment totalCollateral received by this contract
        totalCollateral += _amount;

        // Mint the locker as an NFT to the owner
        safeMint(msg.sender);

        emit Deposit(msg.sender, lockerId, _amount);

        // Check if Batching threshold reached
        if (toBeBatchedCollateral >= batchingThreshold) {
            // Emit event to automate batching
            emit BatchIt(toBeBatchedCollateral);
        }
    }

    /// @notice Close the locker and collect the payout once its matured
    /// @dev nonReentrant used to protect against Reentrancy
    /// @param _lockerId locker that is to be closed
    /// @return payout amount of mAsset sent to locker owner
    function withdraw(uint256 _lockerId)
        external
        override
        isLockerOwner(_lockerId)
        isLockerMatured(_lockerId)
        nonReentrant
        returns (uint256 payout)
    {
        // Redeem Credits from savingsContract
        uint256 totalPayout = savingsContract.redeemCredits(lockerCredits[_lockerId]);

        // Transfer Payout to locker Owner
        require(getMAsset().transfer(ownerOf(_lockerId), totalPayout), "Payout transfer to owner failed");

        emit Withdraw(msg.sender, _lockerId, lockerCredits[_lockerId], totalPayout);

        // Delete Locker
        delete lockerCollateral[_lockerId];
        delete lockerCredits[_lockerId];
        delete lockerMaturity[_lockerId];

        // Burn Locker NFT
        burn(_lockerId);

        return totalPayout;
    }

    /// @notice Batch Deposit all the toBeBatchedCollateral to Savings Contract and distribute credits
    /// @dev little extra credits to the last depositor this batch due to round offs
    function batchExecute() external override {
        require(toBeBatchedCollateral > 0, "No collateral outstanding");

        // deposit the last gathered Collateral to Savings Contract and mint credits to this Contract
        uint256 creditsReceived = savingsContract.depositSavings(
            toBeBatchedCollateral,
            address(this)
        );

        uint256 currentLockerId = _lockerIdCounter.current();
        uint256 allotedCredits = 0;

        // distribute credits to lockers of this batch
        for (uint256 i = lastBatchedLockerId + 1; i < currentLockerId; i++) {
            // Ratio of this locker's collateral to outstanding collateral
            uint256 collateralRatio = lockerCollateral[i].divPrecisely(toBeBatchedCollateral);
            // Set credits based on collateralRatio
            lockerCredits[i] = collateralRatio.mulTruncate(creditsReceived);
            allotedCredits += lockerCredits[i];
        }
        // last one get a little extra because of truncation delta
        lockerCredits[currentLockerId] = creditsReceived - allotedCredits;

        emit BatchCleared(msg.sender, toBeBatchedCollateral, creditsReceived);

        // Reset accumulated collateral
        toBeBatchedCollateral = 0;
        // Set Last batched Locker Id to current
        lastBatchedLockerId = currentLockerId;
        // Update Batched Time
        lastBatchedTime = block.timestamp;
    }

    /// @dev Get the underlying mAsset of the savings contract
    /// @return mAsset Underlying asset contract
    function getMAsset() internal view returns (IERC20 mAsset) {
        return savingsContract.underlying();
    }

    function safeMint(address to) public onlyOwner {
        uint256 lockerId = _lockerIdCounter.current();
        _lockerIdCounter.increment();
        _safeMint(to, lockerId);
    }

    // The following functions are overrides required by Solidity.
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721, ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId);
    }
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
