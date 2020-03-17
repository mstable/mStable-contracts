declare namespace Chai {
    export interface Assertion {
        bignumber: Assertion;
    }
    export interface NumericComparison {
        gt: (value: BN | Date, message?: string) => Chai.Assertion;
    }
}
