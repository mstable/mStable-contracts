import { StandardAccounts } from "@utils/machines";
import { ImmutableModule } from "types/generated";
export interface IModuleBehaviourContext {
    module: ImmutableModule;
    sa: StandardAccounts;
}
export declare function shouldBehaveLikeModule(ctx: IModuleBehaviourContext): void;
export default shouldBehaveLikeModule;
