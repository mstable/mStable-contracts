import { BN } from "@utils/math";
import { MassetMachine, MassetDetails } from "@utils/machines";
import { ERC20 } from "types/generated";
import { Account } from "types";
export interface IERC20BehaviourContext {
    token: ERC20;
    mAssetMachine: MassetMachine;
    initialHolder: Account;
    recipient: Account;
    anotherAccount: Account;
    details: MassetDetails;
}
/**
 *
 * @param ctx is only resolved after the callers before and beforeAll functions are run.
 * So initially ctx will be an empty object. The before and beforeAll will add the properties
 * @param errorPrefix
 * @param initialSupply
 */
export declare function shouldBehaveLikeERC20(ctx: IERC20BehaviourContext, errorPrefix: string, initialSupply: BN): void;
export default shouldBehaveLikeERC20;
