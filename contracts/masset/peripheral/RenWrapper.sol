// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.0;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IGateway {
    function mint(
        bytes32 _pHash,
        uint256 _amount,
        bytes32 _nHash,
        bytes calldata _sig
    ) external returns (uint256);

    function burn(bytes calldata _to, uint256 _amount) external returns (uint256);
}

interface IGatewayRegistry {
    function getGatewayBySymbol(string calldata _tokenSymbol) external view returns (IGateway);

    function getTokenBySymbol(string calldata _tokenSymbol) external view returns (IERC20);
}

contract RenWrapper {
    using SafeERC20 for IERC20;

    address public immutable mAsset;
    address public immutable gatewayRegistry;

    event Minted(
        address indexed minter,
        address recipient,
        uint256 mAssetQuantity,
        address input,
        uint256 inputQuantity
    );

    constructor(address _mAsset, address _gatewayRegistry) public {
        require(_mAsset != address(0), "Invalid mAsset address");
        mAsset = _mAsset;
        require(_gatewayRegistry != address(0), "Invalid gateway registry address");
        gatewayRegistry = _gatewayRegistry;

        IGatewayRegistry(_gatewayRegistry).getTokenBySymbol("BTC").safeApprove(
            _mAsset,
            type(uint256).max
        );
    }

    function depositAndMint(
        address _recipient,
        uint256 _minOutputAmount,
        uint256 _amount,
        bytes32 _nHash,
        bytes calldata _sig
    ) external {
        bytes32 pHash = keccak256(abi.encode(_recipient, _minOutputAmount));

        uint256 mintedAmount =
        IGatewayRegistry(gatewayRegistry).getGatewayBySymbol("BTC").mint(
            pHash,
            _amount,
            _nHash,
            _sig
        );

        require(mintedAmount > _minOutputAmount, "Minted asset must be > min output");

        _mint(mintedAmount, _minOutputAmount, _recipient);
    }

    function _mint(
        uint256 _amount,
        uint256 _minOutputAmount,
        address _recipient
    ) internal {
        address asset = address(IGatewayRegistry(gatewayRegistry).getTokenBySymbol("BTC"));

        // Fake "mint"
        emit Minted(msg.sender, _recipient, _minOutputAmount, asset, _amount);
    }
}