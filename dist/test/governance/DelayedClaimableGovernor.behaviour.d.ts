import { Account } from "types";
import { DelayedClaimableGovernor } from "types/generated";
export interface IGovernableBehaviourContext {
    claimable: DelayedClaimableGovernor;
    default: Account;
    governor: Account;
    other: Account;
}
export declare function shouldBehaveLikeDelayedClaimable(ctx: IGovernableBehaviourContext): void;
