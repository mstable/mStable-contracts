# Slither scripts | ERC20 detection

Detect [ERC20](https://github.com/ethereum/EIPs/blob/master/EIPS/eip-20.md) interface in any Solidity smart contract using [Slither](https://github.com/trailofbits/slither).

The `erc20.py` script currently looks for:
- ERC20 functions signatures definition and visibility
- Custom modifiers in ERC20 functions
- ERC20 event signatures definition
- Visible (i.e. `public` or `external`) getters (as visible functions or `public` state variables)
- Allowance frontrunning mitigation with functions [`increaseAllowance (address, uint256)`](https://github.com/OpenZeppelin/openzeppelin-solidity/blob/7fb90a1566d668bea8e25e9c769cf878f14e8ed3/contracts/token/ERC20/ERC20.sol#L105) and [`decreaseAllowance (address, uint256)`](https://github.com/OpenZeppelin/openzeppelin-solidity/blob/7fb90a1566d668bea8e25e9c769cf878f14e8ed3/contracts/token/ERC20/ERC20.sol#L123)
- Function calls emitting the expected events:
    - `transfer` and `transferFrom` must emit `Transfer (address, address, uint256)`
    - `approve` must emit `Approval (address, address, uint256)`
    - `increaseAllowance` and `decreaseAllowance` should emit `Approval (address, address, uint256)`
- [Non-standard balance checks](https://github.com/sec-bit/awesome-buggy-erc20-tokens/blob/master/ERC20_token_issue_list.md#a19-approve-with-balance-verify) in `approve` function

## Usage
`python erc20.py <contract.sol> <contract-name>`


