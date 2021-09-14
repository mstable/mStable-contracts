<br/>
<img src="https://mstable.org/assets/img/email/mstable_logo_horizontal_black.png" width="420" >

![CI](https://github.com/mstable/mStable-contracts/workflows/Test/badge.svg)
[![Coverage Status](https://coveralls.io/repos/github/mstable/mStable-contracts/badge.svg?branch=master&t=BVkH5s)](https://coveralls.io/github/mstable/mStable-contracts?branch=master)
[![Discord](https://img.shields.io/discord/525087739801239552?color=7289DA&label=discord%20)](https://discordapp.com/channels/525087739801239552/)
[![npm version](https://badge.fury.io/js/%40mstable%2Fprotocol.svg)](https://badge.fury.io/js/%40mstable%2Fprotocol)

<br />

This repo contains all contracts and tests relevant to the core mStable protocol. mStable is a protocol built to make stablecoins easy, robust and profitable.

mStable Assets ([mAssets](./contracts/masset/Masset.sol)) are tokens that allow minting and redemption for underlying Basket Assets (`bAssets`) of the same peg (i.e. USD, BTC, Gold). The InvariantValidator applies both min and max weights to these bAssets, and enforces penalties and bonuses when minting with these assets to provide low slippage swaps. This Invariant applies progressive penalties and bonuses on either end of the weight scale - having the result of having a large area of low slippage. `bAssets` are integrated with lending protocols (initially Aave, Compound) to generate interest which is accrued in `mAsset` terms. mAssets can be deposited to earn native interest through their respective Savings Contract, just like you would with a savings account. `bAssets` within an `mAsset` can also be swapped with low slippage (provided they remain within their [validator](./contracts/masset/InvariantValidator.sol) limits), with a `swapFee` credited additionally to Savers.

Core mAsset contracts utilise OpenZeppelin's [InitializableAdminUpgradeabilityProxy](https://github.com/OpenZeppelin/openzeppelin-sdk/blob/master/packages/lib/contracts/upgradeability/InitializableAdminUpgradeabilityProxy.sol) to facilitate future upgrades, fixes or feature additions. The upgrades are proposed by the mStable Governors (with current governor address stored in the [Nexus](./contracts/nexus/Nexus.sol) - the system kernel) and executed via the [DelayedProxyAdmin](./contracts/upgradability/DelayedProxyAdmin.sol). Both changes to the `governor`, and contract upgrades have a one week delay built in to execution. This allows mStable users a one week opt out window if they do not agree with the given change.

mStable rewards those who contribute to its utility and growth - for more information see [MTA](https://docs.mstable.org/mstable-assets/functions).

<br />

🏠 https://mstable.org  
📀 https://app.mstable.org  
📄 https://docs.mstable.org

<br />

## Bug bounty

Found a bug? Claim a reward from our open [Bug Bounty](https://docs.mstable.org/protocol/security/mstable-bug-bounty) by reporting it to mStable (following the [responsible disclosure](https://docs.mstable.org/protocol/security/mstable-bug-bounty#responsible-disclosure) policy)

<br />

---

<br />

## Branches

-   `master` contains complete, tested and audited contract code, generally on `mainnet`
-   `beta` is for the pre-release code, generally on `ropsten`

<br />

## Artifacts

We publish the contract artifacts to an npm package called [@mstable/protocol](https://www.npmjs.com/package/@mstable/protocol). You can browse them via [unpkg.com](https://unpkg.com/browse/@mstable/protocol@latest/).

<br />

## Dev notes

### Prerequisites

-   Node.js v10.22.0 (you may wish to use [nvm][1])
-   [ganache-cli][2]

### Installing dependencies

```
$ yarn
```

### Testing

Tests are written with Hardhat, Ethers, Waffle & Typescript, using [Typechain](https://github.com/ethereum-ts/TypeChain) to generate typings for all contracts. Tests are executed using `hardhat` in hardhats evm.

```
$ yarn test
```

#### Suite

Key folders:

-   `/contracts/z_mocks`: All mocks used throughout the test suite
-   `/security`: Scripts used to run static analysis tools like Slither and Securify
-   `/test`: Unit tests in folders corresponding to contracts/xx
-   `/test-utils`: Core util files used throughout the test framework
    -   `/machines`: Mock contract machines for creating configurable instances of the contracts
-   `/types`: TS Types used throughout the suite
    -   `/generated`: Output from Typechain; strongly-typed, Ethers-flavoured contract interfaces

#### Coverage

[Solidity-coverage](https://github.com/sc-forks/solidity-coverage) is used to run coverage analysis on test suite.

This produces reports that are visible in the `/coverage` folder, and navigatable/uploadable. Ultimately they are used as a reference that there is some sort of adequate cover, although they will not be a source of truth for a robust test framework. Reports publically available on [coveralls](https://coveralls.io/github/mstable/mStable-contracts).

_NB: solidity-coverage runs with solc `optimizer=false` (see [discussion](https://github.com/sc-forks/solidity-coverage/issues/417))_

### CI

Codebase rules are enforced through a passing [CI](https://circleci.com) (visible in `.circleci/config.yml`). These rules are:

-   Linting of both the contracts (through Solium) and TS files (ESLint)
-   Passing test suite
-   Maintaining high unit testing coverage

### Code formatting

-   Solidity imports deconstructed as `import { xxx } from "../xxx.sol"`
-   Solidity commented as per [NatSpec format](https://solidity.readthedocs.io/en/v0.5.0/layout-of-source-files.html#comments)
-   Internal function ordering from high > low order

<br />

[1]: https://github.com/nvm-sh/nvm
[2]: https://github.com/trufflesuite/ganache-cli

### Command Line Interface

[Hardhat Tasks](https://hardhat.org/guides/create-task.html) are used for command line interactions with the mStable contracts. The tasks can be found in the [tasks](./tasks) folder.

A separate Hardhat config file [tasks.config.ts](./tasks.config.ts) is used for task config. This inherits from the main Hardhat config file [hardhat.config.ts](./hardhat.config.ts). This avoids circular dependencies when the repository needs to be compiled before the Typechain artifacts have been generated. This means the `--config tasks.config.ts` Hardhat option needs to be used to run the mStable tasks.

Config your network. If you are just using readonly tasks like `mBTC-snap` you don't need to have a signer with Ether in it so the default Hardhat test account is ok to use. For safety, the mainnet config is not committed to the repository to avoid accidentally running tasks against mainnet.

```
mainnet: {
    url: process.env.NODE_URL || "",
    accounts: {
        mnemonic: "test test test test test test test test test test test junk",
    },
},
```

**Never commit mainnet private keys, mnemonics or provider URLs to the repository.**

Examples of using the Hardhat tasks

```zsh
# List all Hardhat tasks
hh --config tasks.config.ts

# Set the provider url
export NODE_URL=https://mainnet.infura.io/v3/yourApiKey

# To run the mBTC-snap task against mainnet
yarn task mBTC-snap --network mainnet
```
