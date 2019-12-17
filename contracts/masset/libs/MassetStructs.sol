pragma solidity ^0.5.12;

/**
  * @title MassetStructs
  * @dev Structs used in the Masset contract and associated Libs
  */
interface MassetStructs {

    struct Basket {

        /**
         * @dev Array of Bassets currently active
         */
        Basset[] bassets;

        /**
         * @dev Old Bassets that have been removed from the system
         */
        address[] expiredBassets;

        /**
         * @dev Grace is the amount of leniancy given to a basket during an adjustment phase
         * 0.2% Grace (2e15) allows for a 0.2% deviation from the optimal target weightings
         */
        uint256 grace;

        /**
         * @dev In the event that we do not raise enough funds from the auctioning of a failed Basset,
         * The Basket is deemed as failed, and is undercollateralised to a certain degree.
         * The collateralisation ratio is used to calc Masset burn rate.
         */
        bool failed;
        uint256 collateralisationRatio;

    }

    struct Basset {

        /** @dev Address of the Basset */
        address addr;

        /** @dev Basset decimals */
        uint256 decimals;

        /** @dev Bytes32 key used for Oracle price lookups */
        bytes32 key;

        /** @dev 1 Basset * ratio / ratioScale == 1 Masset (relative value) */
        uint256 ratio;

        /** @dev Target weights of the Basset (100% == 1e18) */
        uint256 targetWeight;

        /** @dev Amount of the Basset that is held in Collateral */
        uint256 vaultBalance;

        /** @dev Status of the basset,  */
        BassetStatus status;
    }


    /** @dev Status of the Basset - has it broken its peg? */
    enum BassetStatus {
        Normal,
        BrokenBelowPeg,
        BrokenAbovePeg,
        Liquidating,
        Liquidated,
        Failed
    }
}
