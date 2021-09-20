# Adapting mStable Feeder Pool for RAI

This file provides documentation for the pull request to adapt mStable's feeder contracts so a RAI fPool can be created
as described at [gitcoin](https://gitcoin.co/issue/stefanionescu/mStable-contracts/1/100026468).

## Licence

All changes are made under the AGPL-3.0-or-later [licence](LICENSE)

## Description of Modifications

MStable's FeederPool contracts were not initially designed to handle assets with a flexible target price, but they were
designed to accommodate assets with varying levels of precision. This change adapts the feeder contracts to handle RAI
by keeping the mechanism used to adjust the precision of fAssets but updating the ratio whenever it's used rather than
only setting it during initialisation. The updates ate performed by reading RAIs redemption price and using it as a
scaling factor on the original ratio set by the precision.

All mStable fPools use the same FeederPool [contract](contracts/feeders/FeederPool.sol), so this has been modified to
make the updates to the ratio wherever necessary. There are two paths taken to perform updates, one for where storage
results are required and one for view functions returning memory. New pegged assets will keep the original behaviour
without any relevant overhead. By not passing in a real address for the redemption price getter contract the ratio will
be set once at initialisation and updates will exit early before changing anything.

### Contracts
[ExposedFeederPool.sol](contracts/z_mocks/feeder/ExposedFeederPool.sol) Mock has been updated to pass through the
address of the contract which provides the snapshot of RAIs redemption price.

[IFAssetRedemptionPriceGetter.sol](contracts/interfaces/IFAssetRedemptionPriceGetter.sol) Added an interface to describe
the RAI redemption price snapshot provider contract. 

[RedemptionPriceSnapMock.sol](contracts/z_mocks/feeder/RedemptionPriceSnapMock.sol) Added a mock of the redemption price
provider [contract](https://github.com/reflexer-labs/geb-redemption-price-snap/blob/master/src/RedemptionPriceSnap.sol).
It emulates the generated snappedRedemptionPrice() getter function and adds a setter so the redemption price can be
manipulated during tests.

[FeederPool.sol](contracts/feeders/FeederPool.sol) This is where the core of the changes have been made and are
described in more detail below.

#### State Variables:
Added constants so contract source is more descriptive, fAssetBaseRatio memento of base ratio from precision to save gas
in later updates and storage of the fAssetRedemptionPriceGetter.

####constructor():
Added an additional input argument so the redemption_price_snap address can be stored.

####initialize():
Now also saves the calculation of fAssets ratio to make updates cheaper.

####State modifying functions bAssetData:
mint(), mintMulti(), swap(), redeem(), redeemProportionately(), redeemExactBassets(), collectPlatformInterest()
These are state changing methods which pass data to FeederLogic.mint as storage, so they now update data with a call
to _updateBassetData() before using it. This means the unchanged logic library methods will work with values scaled by
fresh reads of the redemption price snapshot.

####View functions reading bAssetData:
getMintOutput(), getMintMultiOutput(), getSwapOutput(), getRedeemOutput(), getRedeemExactBassetsOutput(), getPrice(),
getBasset(), getBassets(), These are view methods which need to read the redemption price. Instead of using
data.bAssetData they now call _getMemBassetData() which returns a memory copy with the fAsset ratio replaced by a newly
scaled result.

####_getMemBassetData():
New view function which returns a memory copy of data.bAssetData but with the feeder assets ratio replaced with a newly
read version. Immediately returns data.bAssetData instead if fAssetRedemptionPriceGetter has not been set to minimise
gas usage.

####_getRatioFromRedemptionPrice():
New view function which reads the redemption price snapshot and uses it to scale the original ratio, also handles
scaling the price and casting the result for convenience. This is called from many other view methods so a read only
method simplifies modifications, avoids surprise slippage and _minOutputQuantity errors, saves gas in trade txs and
removes need for special treatment in mStable user interfaces.

####_updateBassetData():
If fAssetRedemptionPriceGetter has not been set immediately exits without acting, otherwise data.bAssetData storage
gets modified to update the feeder assets ratio.

### Tests
The feeder is covered by all pre-existing tests, but they do not set the address for the redemption price provider. New
tests have been added which focus on setting the price getter and ensuring mint, redeem and swaps work as they should
taking into account the redemption price. Tests can be run per file with "yarn hardhat test test/feeders/swap.spec.ts"
and replacing the filename, or all of them with "yarn test", after getting dependencies with yarn.

[test-utils/machines/feederMachine.ts](test-utils/machines/feederMachine.ts): Adds modifications to allow tests to
deploy and interact with the redemption price provider contract. This has enabled the following tests to optionally
run their setup functions with useRedemptionPrice set to true so they can modify it.

[mint.spec.ts](test/feeders/mint.spec.ts): Now performs an additional series of mints after modifying the redemption
price and ratios of assets in the pool. Deposits both mStable asset and feeder asset and checks the awarded pool tokens
are correct. Also makes sure the redemption price is taken into account in calculations which prevent actions which
leave one side over its weight limit.

[redeem.spec.ts](test/feeders/redeem.spec.ts): Added extra redeem, redeemExact and assertRedeemProportionately actions
performed after modifying the redemption price. Ensures ratios of pool tokens in to fAssets, mAssets and bAssets out is
correct and that the redemption price is taken into account in overweight checks.

[swap.spec.ts](test/feeders/swap.spec.ts): Added additional tests to the swap contexts to make sure the swap results
are proportional to the redemption price. Swaps are performed in multiple directions between feeder, mStable and main
pool assets to ensure they all respect the redemption price.
