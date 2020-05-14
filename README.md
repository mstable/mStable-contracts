<br/>
<img src="https://mstable.org/assets/img/email/mstable_logo_horizontal_black.png" width="420" >

[![CircleCI](https://circleci.com/gh/mstable/mStable-contracts.svg?style=svg&circle-token=a8bb29a97a0a0949a15cc28bd9b2245960287bc2)](https://circleci.com/gh/mstable/mStable-contracts)
[![Coverage Status](https://coveralls.io/repos/github/mstable/mStable-contracts/badge.svg?t=7A5XxE)](https://coveralls.io/github/mstable/mStable-contracts)
[![Discord](https://img.shields.io/discord/525087739801239552?color=7289DA&label=discord%20)](https://discordapp.com/channels/525087739801239552/)


<br />

This repo contains all contracts and tests relevant to the core mStable protocol. The mStable Standard is a protocol that makes stablecoins and other tokenized assets easy, robust and profitable.
This is what mAssets are
This is upgradability / delayed proxy admin
This is what minting/redemption is
This is what the gov token is
This is what saving is


mStable is built by Stability Labs, a software development company that is driven to make finance safe, secure and transparent.

<br />

🏠 https://mstable.org  
📀 https://app.mstable.org  
📄 https://docs.mstable.org  


<br />

---

<br />

## Branches

- `master` contains complete, tested and audited contract code, generally on `mainnet`
- `beta` is for the pre-release code, generally on `ropsten`

<br />

## Dev notes

### Installing dependencies

```
$ yarn
```

### Running migrations

Deployment scripts are located in `migrations/src`. To run, start `ganache` or `ganache-cli` and run the migration script.

*NB: You should locally use the latest version of `ganache-cli`, as contracts rely on recent opcodes*

```
$ ganache-cli -p 7545
$ yarn migrate
```

### Testing

Tests are written in Typescript, using [Typechain](https://github.com/ethereum-ts/TypeChain) to generate typings for all contracts. Tests are executed using `truffle` and `ganache-cli`.

```
$ ganache-cli -p 7545 -l 50000000 --allowUnlimitedContractSize
$ yarn test
```

#### Ganache-fork

mStable-contracts test suite is built to support execution on a [mainnet fork](https://medium.com/ethereum-grid/forking-ethereum-mainnet-mint-your-own-dai-d8b62a82b3f7) of ganache. This allows tests to be ran using all mainnet dependencies (bAssets, lending protocols). To do this, certain mainnet accounts need to be unlocked to allows tx to be sent from that origin. 

*NB: The following commands assume you have a full Ethereum node running and exposed on local port 1234*

```
$ ganache-cli -f http://localhost:1234 -p 7545 -l 100000000 --allowUnlimitedContractSize --unlock "0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b" --unlock "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE" --unlock "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3"
$ yarn test-prep
$ truffle test ./test/xxx.spec.tx --network fork
```

#### Suite

Key folders:

- `/contracts/z_mocks`: All mocks used throughout the test suite
- `/security`: Scripts used to run static analysis tools like Slither and Securify
- `/test`: Unit tests in folders corresponding to contracts/xx
- `/test-utils`: Core util files used throughout the test framework
  - `/machines`: Mock contract machines for creating configurable instances of the contracts
- `/types`: TS Types used throughout the suite
  - `/generated`: Output from Typechain; strongly-typed, Truffle-flavoured contract interfaces


#### Coverage

[Solidity-coverage](https://github.com/sc-forks/solidity-coverage) is used to run coverage analysis on test suite.

This produces reports that are visible in the `/coverage` folder, and navigatable/uploadable. Ultimately they are used as a reference that there is some sort of adequate cover, although they will not be a source of truth for a robust test framework. Reports publically available on [coveralls](https://coveralls.io/github/mstable/mStable-contracts).

*NB: solidity-coverage runs with solc `optimizer=false` (see [discussion](https://github.com/sc-forks/solidity-coverage/issues/417))*


### Scripts

`script [scriptName] [args]` > Runs custom Truffle scripts

Example usage:

* Mint 100 MUSD: `yarn script mint 100`
* Redeem 100 of the MUSD basset at index 0 (USDT): `yarn redeem-basset 0 100`
* Deposit 100 mUSD into savings: `yarn deposit-savings 100`
* Withdraw 100 mUSD from savings: `yarn withdraw-savings 100`
* Travel through time (forwards only, sorry): `yarn script time-travel 1 year`

### CI

Codebase rules are enforced through a passing [CI](https://circleci.com) (visible in `.circleci/config.yml`). These rules are:

- Linting of both the contracts (through Solium) and TS files (ESLint)
- Passing test suite
- Maintaining high unit testing coverage

### Code formatting

- Solidity imports deconstructed as `import { xxx } from "../xxx.sol"`
- Solidity commented as per [NatSpec format](https://solidity.readthedocs.io/en/v0.5.0/layout-of-source-files.html#comments)
- Internal function ordering from high > low order

<br />

