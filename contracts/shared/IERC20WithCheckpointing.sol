pragma solidity 0.5.16;

// From https://github.com/aragonone/voting-connectors
contract IERC20WithCheckpointing {
    function balanceOf(address _owner) public view returns (uint256);
    function balanceOfAt(address _owner, uint256 _blockNumber) public view returns (uint256);

    function totalSupply() public view returns (uint256);
    function totalSupplyAt(uint256 _blockNumber) public view returns (uint256);
}