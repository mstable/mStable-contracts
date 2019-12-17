

## ForgeLib

Purpose: Validate that a given Forge is valid

To be valid, a Forge must:
 - Only use Bassets that are whitelisted and not isolated from the Basket
 - Be valid if the resulting basket is closer to the target, or within a `Grace` threshold

The Masset will call this function to validate the inputs, before moving the collateral and 
issuing/redeeming a calculated number of Massets


### Basset Status / Isolation

Isolated Bassets are considered to have 0 Target Weight and 0 vault balance, for the purposes
of validation. The **relative** non-isolated Targets and Vault balances are added up and used 
to calculate quantities etc.

1. BassetStatus.Normal
Minting > Normal. Redemption > Normal.
2. BassetStatus.BrokenBelowPeg
Minting > Isolated. Redemption > Normal.
3. BassetStatus.BrokenAbovePeg
Minting > Normal. Redemption > Isolated
4. BassetStatus.Liquidating
Minting > Isolated. Redemption > COMPLETE BLOCK.
5. BassetStatus.Liquidated
Liquidated Bassets have 0 T and 0 Vault by design, set when Liquidation begins
Plus, we immediately remove them.
6. Basket is Failed
Minting > COMPLETELY BLOCKED. Redemption > Normal (OVERRIDES isolation from #3)
7. All Bassets isolated >> 0 T[0,0...] B[0,0...]


### Grace

ForgeLibV1 uses a percentage based grace unit, i.e. the basket can deviate from it's target
by 1% (1e16)

ForgeLibv2 uses a unit based grace unit, i.e. the basket can deviate from it's target by 
the equivalent of 1e18 Masset units (1 Masset), or 1e24 Masset units (1 million Massets)


#### Examples - Unit based Grace


Scenario 1 - Basic Mint
=========================

Targets T = [40, 40, 20]

Vault PRE = [450e18, 350e18, 220e18]
    Total = 1020 Massets
Ideal PRE = [408e18, 408e18, 204e18]
    Delta = [ 42e18,  58e18,  16e18]
    Total = 116e18

Vault POS = [480e18, 350e18, 220e18]
    Total = 1050 Massets
Ideal PRE = [420e18, 420e18, 210e18]
    Delta = [ 60e18,  70e18,  10e18]
    Total = 140e18

If grace > 1401e8, then it's valid


Scenario 2 - Isolated Basset, mint includes in delta calc
=========================

Targets T = [40, 40, 10, 10]

Isolated  = [no, no, yes, no]

Vault PRE = [500e18, 380e18, 180e18, 110e18]
    Total = 1170 Massets
Ideal PRE = [468e18, 468e18, 117e18, 117e18]
    Delta = [ 32e18,  88e18,  63e18,   7e18]
    Total = 190e18
    
Vault POS = [600e18, 500e18, 180e18, 110e18]
    Total = 1390 Massets
Ideal POS = [556e18, 556e18, 139e18, 139e18]
    Delta = [ 44e18,  56e18,  41e18,  29e18]
    Total = 170e18



Scenario 3 - Isolated Basset, mint rejects from delta calc
=========================

Targets T = [40, 40, 10, 10]

Isolated  = [no, no, yes, no]

Vault PRE = [500e18, 380e18,  0e18, 110e18]
    Total = 990 Massets
RelativeT = [44.44,   44.44,     0,  11.11]
Ideal PRE = [440e18, 440e18,     0, 110e18]
    Delta = [ 60e18,  60e18,     0,   0e18]
    Total = 120e18
    
Vault POS = [600e18, 490e18,  0e18, 110e18]
    Total = 1200 Massets
RelativeT = [ 44.44,  44.44,     0,  11.11]
Ideal POS = [533e18, 533e18,     0, 133e18]
    Delta = [ 67e18,  43e18,     0,  23e18]
    Total = 133e18
    

FWIW - Assets are isolated from the mint side when Liquidating or BrokenBelowPeg
                           from the redeem side when BrokenAbovePeg


Including Isolated Bassets (but not allowing them to be used) means..
 - We track closer to the overall basket targets, as the delta still remains and is counted. i.e.
   if Basset C is isolated, but uses up -800 of a 1000 unit grace, the basket will actually fail if
   business continues as usual, as total basket collateral will rise and push C downwards. Mints must
   account for  

Excluding Isolated Bassets means..
 - An allotment of optionality is immediately opened up when a Basset is isolated, which is consequently
   reduced after re-introduction, which will force the baskets to move back towards the targets
   


