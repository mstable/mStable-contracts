// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.6;
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Yield Bearing Vault
interface IERC4626Vault {
    /**
     * @dev Must be an ERC-20 token contract. Must not revert.
     *
     * Returns the address of the underlying token used for the Vault uses for accounting, depositing, and withdrawing
     */
    function asset() external view returns (address assetTokenAddress);

    /**
     * @dev It should include any compounding that occurs from yield. It must be inclusive of any fees that are charged against assets in the Vault. It must not revert.
     *
     * Returns the total amount of the underlying asset that is “managed” by Vault.
     */
    function totalAssets() external view returns (uint256 totalManagedAssets);

    /**
     * @dev It must be inclusive of any fees that are charged against assets in the Vault.
     *
     * Returns the current exchange rate of shares to assets, quoted per unit share (share unit is 10 ** Vault.decimals()).
     */
    function assetsPerShare() external view returns (uint256 assetsPerUnitShare);

    /**
     * @dev It MAY be more accurate than using assetsPerShare or totalAssets / Vault.totalSupply for certain types of fee calculations.
     *
     * Returns the total number of underlying assets that depositor’s shares represent.
     */
    function assetsOf(address depositor) external view returns (uint256 assets);

    /**
     * @dev It must return a limited value if caller is subject to some deposit limit. must return 2 ** 256 - 1 if there is no limit on the maximum amount of assets that may be deposited.
     *
     * Returns the total number of underlying assets that caller can be deposit.
     */
    function maxDeposit(address caller) external view returns (uint256 maxAssets);

    /**
     * @dev It must return the exact amount of Vault shares that would be minted if the caller were to deposit a given exact amount of underlying assets using the deposit method.
     *
     * It simulate the effects of their deposit at the current block, given current on-chain conditions.
     * Returns the amount of shares.
     */
    function previewDeposit(uint256 assets) external view returns (uint256 shares);

    /**
     *
     *  Mints shares Vault shares to receiver by depositing exactly amount of underlying tokens.
     *  Returns the amount of shares minted.
     * Emits a {Deposit} event.
     */
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    /**
     * @dev must return a limited value if caller is subject to some deposit limit. must return 2 ** 256 - 1 if there is no limit on the maximum amount of shares that may be minted
     *
     *  Returns Total number of underlying shares that caller can be mint.
     */
    function maxMint(address caller) external view returns (uint256 maxShares);

    /**
     * @dev Allows an on-chain or off-chain user to simulate the effects of their mint at the current block, given current on-chain conditions.
     *
     *  Returns Total number of underlying shares to be minted.
     */
    function previewMint(uint256 shares) external view returns (uint256 assets);

    /**
     * Mints exactly shares Vault shares to receiver by depositing amount of underlying tokens.
     *
     * Returns Total number of underlying shares that caller mint.
     * Emits a {Deposit} event.
     */
    function mint(uint256 shares, address receiver) external returns (uint256 assets);

    /**
     *
     *  Returns Total number of underlying assets that caller can withdraw.
     */
    function maxWithdraw(address caller) external view returns (uint256 maxAssets);

    /**
     * @dev Allows an on-chain or off-chain user to simulate the effects of their withdrawal at the current block, given current on-chain conditions.
     *
     *  Return the exact amount of Vault shares that would be redeemed by the caller if withdrawing a given exact amount of underlying assets using the withdraw method.
     */
    function previewWithdraw(uint256 assets) external view returns (uint256 shares);

    /**
     * @dev Allows an on-chain or off-chain user to simulate the effects of their mint at the current block, given current on-chain conditions.
     *  Redeems shares from owner and sends assets of underlying tokens to receiver.
     *  Returns Total number of underlying shares redeemed.
     * Emits a {Withdraw} event.
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external returns (uint256 shares);

    /**
     * @dev it must return a limited value if caller is subject to some withdrawal limit or timelock. must return balanceOf(caller) if caller is not subject to any withdrawal limit or timelock. MAY be used in the previewRedeem or redeem methods for shares input parameter. must NOT revert.
     *
     *  Returns Total number of underlying shares that caller can redeem.
     */
    function maxRedeem(address caller) external view returns (uint256);

    /**
     * @dev Allows an on-chain or off-chain user to simulate the effects of their redeemption at the current block, given current on-chain conditions.
     *
     *  Returns the exact amount of underlying assets that would be withdrawn by the caller if redeeming a given exact amount of Vault shares using the redeem method
     */
    function previewRedeem(uint256 shares) external view returns (uint256 assets);

    /**
     * Redeems shares from owner and sends assets of underlying tokens to receiver.
     *
     *  Returns Total number of underlying assets of underlying redeemed.
     * Emits a {Withdraw} event.
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external returns (uint256 assets);

    /*///////////////////////////////////////////////////////////////
                                Events
    //////////////////////////////////////////////////////////////*/

    /**
     * @dev Emitted when sender has exchanged assets for shares, and transferred those shares to receiver.
     *
     * Note It must be emitted when tokens are deposited into the Vault in ERC4626.mint or ERC4626.deposit methods.
     *
     */
    event Deposit(address indexed sender, address indexed receiver, uint256 assets);
    /**
     * @dev Emitted when sender has exchanged shares for assets, and transferred those assets to receiver.
     *
     * Note It must be emitted when shares are withdrawn from the Vault in ERC4626.redeem or ERC4626.withdraw methods.
     *
     */
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        uint256 assets,
        uint256 shares
    );
}
