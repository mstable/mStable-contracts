import { InitializableRewardsDistributionRecipient } from "types/generated";
import { IModuleBehaviourContext } from "./Module.behaviour";
export interface IRewardsDistributionRecipientContext extends IModuleBehaviourContext {
    recipient: InitializableRewardsDistributionRecipient;
}
export declare function shouldBehaveLikeDistributionRecipient(ctx: IRewardsDistributionRecipientContext): void;
export default shouldBehaveLikeDistributionRecipient;
