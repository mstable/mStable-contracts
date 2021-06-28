import { StandardAccounts } from "@utils/machines";
import { PausableModule } from "types/generated";
export interface IPausableModuleBehaviourContext {
    module: PausableModule;
    sa: StandardAccounts;
}
export declare function shouldBehaveLikePausableModule(ctx: IPausableModuleBehaviourContext): void;
export default shouldBehaveLikePausableModule;
