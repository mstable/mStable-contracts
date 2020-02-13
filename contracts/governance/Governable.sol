pragma solidity ^0.5.12;

/**
 * @title Taken from OpenZeppelin 2.3.0 Ownable.sol
 * Modified to have custom name and features
 */
contract Governable {
    address private _governor;

    event GovernorChanged(address indexed previousGovernor, address indexed newGovernor);

    /**
     * @dev Initializes the contract setting the deployer as the initial Governor.
     */
    constructor () internal {
        _governor = msg.sender;
        emit GovernorChanged(address(0), _governor);
    }

    /**
     * @dev Returns the address of the current Governor.
     */
    function governor() public view returns (address) {
        return _governor;
    }

    /**
     * @dev Throws if called by any account other than the Governor.
     */
    modifier onlyGovernor() {
        require(isGovernor(), "Governable: caller is not the Governor");
        _;
    }

    /**
     * @dev Returns true if the caller is the current Governor.
     */
    function isGovernor() public view returns (bool) {
        return msg.sender == _governor;
    }

    /**
     * @dev Transfers Governance of the contract to a new account (`newGovernor`).
     * Can only be called by the current Governor.
     */
    function changeGovernor(address newGovernor) public onlyGovernor {
        _changeGovernor(newGovernor);
    }

    /**
     * @dev Change Governance of the contract to a new account (`newGovernor`).
     */
    function _changeGovernor(address newGovernor) internal {
        require(newGovernor != address(0), "Governable: new Governor is the zero address");
        emit GovernorChanged(_governor, newGovernor);
        _governor = newGovernor;
    }
}
