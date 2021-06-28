import { Governable } from "types/generated/Governable";
import { Account } from "types";
export interface IGovernableBehaviourContext {
    governable: Governable;
    owner: Account;
    other: Account;
}
export declare function shouldBehaveLikeGovernable(ctx: IGovernableBehaviourContext): void;
