// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @notice  Allows to redeem MTA for WETH at a fixed rate.
 * @author  mStable
 * @dev     VERSION: 1.0
 *          DATE:    2023-03-08
 */
contract MetaTokenRedeemer {
    using SafeERC20 for IERC20;

    address public immutable MTA;
    address public immutable WETH;
    uint256 public immutable PERIOD_DURATION;
    uint256 public periodStart;
    uint256 public periodEnd;
    uint256 public totalFunded;
    uint256 public totalRegistered;
    mapping(address => uint256) public balances;

    /**
     * @notice Emitted when the redeemer is funded.
     */
    event Funded(address indexed sender, uint256 amount);
    /**
     * @notice Emitted when a user register MTA.
     */
    event Register(address indexed sender, uint256 amount);

    /**
     * @notice Emitted when a user claims WETH for the registered amount.
     */
    event Redeemed(address indexed sender, uint256 registeredAmount, uint256 redeemedAmount);

    /**
     * @notice Crates a new instance of the contract
     * @param _mta MTA Token Address
     * @param _weth WETH Token Address
     * @param _periodDuration The lenght of the registration period.
     */
    constructor(
        address _mta,
        address _weth,
        uint256 _periodDuration
    ) {
        MTA = _mta;
        WETH = _weth;
        PERIOD_DURATION = _periodDuration;
    }

    /**
     * @notice Funds the contract with WETH, and initialize the funding period.
     * It only allows to fund during the funding period.
     * @param amount The Amount of WETH to be transfer to the contract
     */
    function fund(uint256 amount) external {
        require(periodStart == 0 || block.timestamp <= periodEnd, "Funding period ended");

        IERC20(WETH).safeTransferFrom(msg.sender, address(this), amount);
        if (periodStart == 0) {
            periodStart = block.timestamp;
            periodEnd = periodStart + PERIOD_DURATION;
        }
        totalFunded += amount;

        emit Funded(msg.sender, amount);
    }

    /**
     * @notice Allos user to register and transfer a given amount of MTA
     * It only allows to register during the registration period.
     * @param amount The Amount of MTA to register.
     */
    function register(uint256 amount) external {
        require(periodStart > 0, "Registration period not started");
        require(block.timestamp <= periodEnd, "Registration period ended");

        IERC20(MTA).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        totalRegistered += amount;
        emit Register(msg.sender, amount);
    }

    /// @notice Redeems all user MTA balance for WETH at a fixed rate.
    /// @return redeemedAmount The amount of WETH to receive.
    function redeem() external returns (uint256 redeemedAmount) {
        require(periodEnd <= block.timestamp, "Redeem period not started");
        uint256 registeredAmount = balances[msg.sender];
        require(registeredAmount > 0, "No balance");

        // MTA and WETH both have 18 decimal points, no need for scaling.
        redeemedAmount = (registeredAmount * totalRegistered) / totalFunded;
        balances[msg.sender] = 0;

        IERC20(WETH).safeTransfer(msg.sender, redeemedAmount);

        emit Redeemed(msg.sender, registeredAmount, redeemedAmount);
    }
}
