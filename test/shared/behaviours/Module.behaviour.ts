import { StandardAccounts } from "@utils/machines";
import { ZERO_ADDRESS } from "@utils/constants";
import * as t from "types/generated";

const NexusArtifact = artifacts.require("Nexus");

export default function shouldBehaveLikeModule(
    ctx: { module: t.ModuleInstance },
    sa: StandardAccounts,
): void {
    // it("should have all ModuleKeys initialized", async () => {
    //     let key: string;
    //     key = await ctx.module.KEY_GOVERNANCE();
    //     expect(key).to.equal(web3.utils.keccak256("Governance"));

    //     key = await ctx.module.KEY_GOVERNANCE();
    //     expect(key).to.equal(web3.utils.keccak256("ProxyAdmin"));

    //     key = await ctx.module.KEY_STAKING();
    //     expect(key).to.equal(web3.utils.keccak256("Staking"));

    //     key = await ctx.module.KEY_ORACLE_HUB();
    //     expect(key).to.equal(web3.utils.keccak256("OracleHub"));

    //     key = await ctx.module.KEY_MANAGER();
    //     expect(key).to.equal(web3.utils.keccak256("Manager"));

    //     key = await ctx.module.KEY_RECOLLATERALISER();
    //     expect(key).to.equal(web3.utils.keccak256("Recollateraliser"));

    //     key = await ctx.module.KEY_META_TOKEN();
    //     expect(key).to.equal(web3.utils.keccak256("MetaToken"));

    //     key = await ctx.module.KEY_SAVINGS_MANAGER();
    //     expect(key).to.equal(web3.utils.keccak256("SavingsManager"));
    // });

    it("should have Nexus", async () => {
        const nexusAddr = await ctx.module.nexus();
        expect(nexusAddr).to.not.equal(ZERO_ADDRESS);

        const nexus: t.NexusInstance = await NexusArtifact.at(nexusAddr);

        const isInit = await nexus.initialized();
        expect(true).to.equal(isInit);
    });

    it("should have Governor address", async () => {
        const nexusAddr = await ctx.module.nexus();
        const nexus: t.NexusInstance = await NexusArtifact.at(nexusAddr);
        const nexusGovernor = await nexus.governor();
        expect(nexusGovernor).to.equal(sa.governor);
    });
}
