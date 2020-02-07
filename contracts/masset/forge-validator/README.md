

## ForgeValidator

Purpose: Validate that a given Forge is valid

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


