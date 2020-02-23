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
        require(isGovernor(), "GOV: caller is not the Governor");
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
     * @param _newGovernor Address of the new Governor
     */
    function changeGovernor(address _newGovernor) public onlyGovernor {
        _changeGovernor(_newGovernor);
    }

    /**
     * @dev Change Governance of the contract to a new account (`newGovernor`).
     * @param _newGovernor Address of the new Governor
     */
    function _changeGovernor(address _newGovernor) internal {
        require(_newGovernor != address(0), "GOV: new Governor is address(0)");
        emit GovernorChanged(_governor, _newGovernor);
        _governor = _newGovernor;
    }
}
