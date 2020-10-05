pragma solidity 0.5.16;

/**
 * @title IMetaToken
 * @dev Interface for MetaToken
 */
interface IMetaToken {
    /** @dev Basic ERC20 funcs */
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);

    /** @dev Burnable */
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;

    /** @dev Mintable */
    function mint(address account, uint256 amount) external returns (bool);
}