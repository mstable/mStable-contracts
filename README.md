# mStable - Contracts

This repo contains all contracts and tests relevant to the core mStable protocol.


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
- `Handlebars`

Suggested extensions:
- `Auto Import`
- `Better Comments`
- `Bracket Pair Colorizer`
- `Import Cost`
- `Indent-rainbow`
- `Typescript Import Sorter`


Should enforce some certain conditions through efficient use of `.gitlab-ci` and the `yarn run lint` commands. Possibly will require customisation fo the `.soliumrc.json` and the `.prettierrc` in order to produce builds of certain condition.

### Styling

 - Solidity imports deconstructed as `import { xxx } from "../xxx.sol"`
 - Solidity commented as  per [solidity specification](https://solidity.readthedocs.io/en/v0.5.0/layout-of-source-files.html#comments)
 - Internal function code in high > low order
 - Use `yarn run lint` to check formatting of existing solidity code

Should ideally enforce linting, test outcomes and code coverage through CI


### Deploy the Contracts

Start `ganache` or `ganache-cli` locally at `ganache-cli -p 7545`

```
yarn run migrate
```


## Architecture

Nexus is the hub of the system and thus should be deployed first. Each subsequent module should be hooked into the Nexus through governance if it wishes to be discovered by the rest of the system.


## Testing

Tests are written in Typescript. This means we need to generate types for each of the contracts, then deploy a test version of the contract and then wrap it in this type. It is a reasonably sophisticated process but ensures that we remain type safe whilst undergoing tests.

As we use `@0x/abi-gen` to generate the typings for our contracts, we are locked into some dependencies as this is what is used in their `Base-contract` (which is essentially the backbone for all the test contracts).

NB: Due to the MassetFactoryV1 being over the EIP170 for deployable bytecode size (as it needs to deploy whole Masset contract), we need to run the tests with a custom ganache environment. When we go to deploy the contracts on Rinkeby/Mainnet, we will need to trim the bytecode down.

`ganache-cli -p 7545 -l 20000000 --allowUnlimitedContractSize`

### In-test terminology

`xxxArtifact` = The artifact created/retrieved through a truffle migration. This contains address of deployed contract through migrations.  
`xxxInstance` = Deployed instance of the conrtact that will be used in the specific test file.  
`xxxContract` = The .TS contract type as imported from the `types/generated/xxx`.  
`<contract>` = The object we will use to do testing, this is the `INSTANCE` wrapped by the `CONTRACT`

### Rules

We should be SPECIFIC about the deployment addresses used throughout the testing and migration scripts. This allows for maximum security and mitigates the possibility of an error slipping under the radar due to an incorrect deployment addr. (i.e. if we accidently give permissions to a wrong part of the system in prod, while our tests use some different configuration).

With this in mind, we utilise the unlocked `accounts` in a similar fashion across the migrations, test files and `machines`:

`const [_, governor, fundManager, other, other2, oraclePriceProvider] = accounts;`

### Suite 

Test suite uses Typescript, which adds some complexity to the process due to the transpiling of contract ABIs.

c = committed

Key folders:  

- `/artifacts`            [Stores the most recently, locally deployed versions of the contracts including their deployed address]
  - `/index.ts`           [(c)]
  - `/build`                [Contract build output
- `/scripts`              [(c) Contains build and deploy bash scripts]
- `/test-utils`           [(c) Core util files used throughout the test framework]
  - `/machines`           [(c) Mock contract machines for creating configurable instances of our contracts to support the simulation of test scenarios]
- `/transpiled`           [Transpiled (JS) versions of the our TS files and generated types]
- `/types`                [TS Types we use throughout the]
  - `/contract_templates` [(c) Provided by `@0x/abi-gen` as part of the type generation (These are templates to use for converting ABI into Typescript and injecting functionality)]
  - `/generated`          [Output from abi-gen, used for transpiling build output into executable JS]


### Scripts

The scripts can be described as follows:


`test` > Runs Truffle tests E2E
`yarn run compile; yarn run generate-typings; yarn run transpile; yarn run migrate; truffle test`

`compile` > Uses truffle to compile our .sol files into json (build/xx.json) 
`truffle compile --all`

`generate-typings` > Uses '@0x/abi-gen' to convert the ABIs into useful Typescript Types, using the provided templates (note, these strongly dictate functionality)
`abi-gen --abis './build/*.json' --out './types/generated' --template './types/templates.0x/contract.handlebars' --partials './types/templates.0x/partials/*.handlebars'`

`transpile` > Runs the typescript transpiler to compile all .TS files into executable Javascript
`rm -rf ./transpiled; copyfiles ./build/* ./transpiled; tsc`

### Coverage

We make use of `solidity-coverage@beta` (https://github.com/sc-forks/solidity-coverage/tree/beta) to run coverage analysis on our test framework.

This produces super nifty reports that are visible forin the `/coverage` folder, and navigatable/uploadable. Ultimately we will use these as a REFERENCE that we have got some sort of adequate cover, although they will not be a source of truth for a robust test framework.

Note: solidity-coverage runs with solc `optimizer=false` see [discussion](https://github.com/sc-forks/solidity-coverage/issues/417)
