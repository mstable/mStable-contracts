import { ClaimableGovernor } from "types/generated/ClaimableGovernor";
import { Account } from "types";
export interface IClaimableGovernableBehaviourContext {
    claimable: ClaimableGovernor;
    default: Account;
    governor: Account;
    other: Account;
}
export declare function shouldBehaveLikeClaimable(ctx: IClaimableGovernableBehaviourContext): void;
