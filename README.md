 <br/>
  <img src="https://mstable.org/assets/img/email/mstable_logo_horizontal_black.png" width="300" >
 <br/>

[![CircleCI](https://circleci.com/gh/mstable/mStable-contracts.svg?style=svg&circle-token=a8bb29a97a0a0949a15cc28bd9b2245960287bc2)](https://circleci.com/gh/mstable/mStable-contracts)
[![Coverage Status](https://coveralls.io/repos/github/mstable/mStable-contracts/badge.svg?t=7A5XxE)](https://coveralls.io/github/mstable/mStable-contracts)
[![Discord](https://img.shields.io/discord/525087739801239552?color=7289DA&label=discord%20)](https://discordapp.com/channels/525087739801239552/)


This repo contains all contracts and tests relevant to the core mStable protocol.

## Who

Stability Labs Pty. Ltd.


## Dev notes

### Setup

```
yarn
```

### VScode setup

Required extensions:
- `Solidity`
- `TSLint`
- `ESLint`

Suggested extensions:
- `Auto Import`
- `Better Comments`
- `Bracket Pair Colorizer`
- `Import Cost`
- `Indent-rainbow`
- `Typescript Import Sorter`


Should enforce some certain conditions through efficient use of `.gitlab-ci` and the `yarn run lint` commands. Possibly will require customisation of the `.soliumrc.json` and the `.prettierrc` in order to produce builds of certain condition.

### Styling

 - Solidity imports deconstructed as `import { xxx } from "../xxx.sol"`
 - Solidity commented as  per [solidity specification](https://solidity.readthedocs.io/en/v0.5.0/layout-of-source-files.html#comments)
 - Internal function code in high > low order
 - Use `yarn run lint` to check formatting of existing solidity code

Should ideally enforce linting, test outcomes and code coverage through CI


### Deploy the Contracts

Start `ganache` or `ganache-cli` locally at `ganache-cli -p 7545`. The block gas limit needs to match or exceed the limit set in the truffle config.

```
yarn run migrate
```


## Architecture

Nexus is the hub of the system and thus should be deployed first. Each subsequent module should be hooked into the Nexus through governance if it wishes to be discovered by the rest of the system.


## Testing

Tests are written in Typescript. This means we need to generate types for each of the contracts, then deploy a test version of the contract and then wrap it in this type. It is a reasonably sophisticated process but ensures that we remain type safe whilst undergoing tests.

NB: You should locally use the latest version of ganache-cli, as the test rely on recent opcodes

`ganache-cli -p 7545 -l 50000000 --allowUnlimitedContractSize`

### In-test terminology

`xxxContract` = The .TS contract type as imported from the `types/generated/xxx` as output by Typechain. Retrieved through require
`xxxInstance` = Deployed instance of the contract that will be used in the specific test file.

### Rules

We should be SPECIFIC about the deployment addresses used throughout the testing and migration scripts. This allows for maximum security and mitigates the possibility of an error slipping under the radar due to an incorrect deployment addr. (i.e. if we accidently give permissions to a wrong part of the system in prod, while our tests use some different configuration).

With this in mind, we utilise the unlocked `accounts` in a similar fashion across the migrations, test files and `machines`:

`const [_, governor, fundManager, other, other2, oraclePriceProvider] = accounts;`

### Suite

The test suite uses Typescript, which is compiled and run by Truffle.

c = committed

Key folders:

- `/test-utils`           [(c) Core util files used throughout the test framework]
  - `/machines`           [(c) Mock contract machines for creating configurable instances of our contracts to support the simulation of test scenarios]
- `/types`                [TS Types we use throughout the]
  - `/contract_templates` [(c) Provided by `@0x/abi-gen` as part of the type generation (These are templates to use for converting ABI into Typescript and injecting functionality)]
  - `/generated`          [Output from Typechain; strongly-typed, Truffle-flavoured contract interfaces]


### Scripts

The scripts can be described as follows:


`test` > Runs Truffle tests E2E
`yarn run compile; yarn run generate-typings; yarn run migrate; truffle test`

`compile` > Uses truffle to compile our .sol files into json (build/xx.json)
`truffle compile --all`

`generate-typings` > Uses [Typechain](https://github.com/ethereum-ts/TypeChain) to convert the ABIs into useful Typescript Types
`rimraf ./types/generated && typechain --target truffle --outDir types/generated './build/*.json'`

`script [scriptName] [args]` > Runs custom Truffle scripts

Example usage:

* Mint 100 MUSD: `yarn script mint 100`
* Redeem 100 of the MUSD basset at index 0 (USDT): `yarn redeem-basset 0 100`
* Deposit 100 mUSD into savings: `yarn deposit-savings 100`
* Withdraw 100 mUSD from savings: `yarn withdraw-savings 100`
* Travel through time (forwards only, sorry): `yarn script time-travel 1 year`

### Coverage

We make use of `solidity-coverage@beta` (https://github.com/sc-forks/solidity-coverage/tree/beta) to run coverage analysis on our test framework.

This produces super nifty reports that are visible forin the `/coverage` folder, and navigatable/uploadable. Ultimately we will use these as a REFERENCE that we have got some sort of adequate cover, although they will not be a source of truth for a robust test framework.

Note: solidity-coverage runs with solc `optimizer=false` see [discussion](https://github.com/sc-forks/solidity-coverage/issues/417)
