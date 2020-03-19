import { StandardAccounts } from "@utils/machines";
import { ModuleInstance, NexusInstance } from "types/generated";
import { ZERO_ADDRESS } from "@utils/constants";

const NexusArtifact = artifacts.require("Nexus");

export default function shouldBehaveLikeModule(
    ctx: { module: ModuleInstance },
    sa: StandardAccounts,
) {
    it("should have all ModuleKeys initialized", async () => {
        let key: string;
        key = await ctx.module.Key_Governance();
        expect(key).to.equal(web3.utils.keccak256("Governance"));

        key = await ctx.module.Key_Staking();
        expect(key).to.equal(web3.utils.keccak256("Staking"));

        key = await ctx.module.Key_OracleHub();
        expect(key).to.equal(web3.utils.keccak256("OracleHub"));

        key = await ctx.module.Key_Manager();
        expect(key).to.equal(web3.utils.keccak256("Manager"));

        key = await ctx.module.Key_Recollateraliser();
        expect(key).to.equal(web3.utils.keccak256("Recollateraliser"));

        key = await ctx.module.Key_MetaToken();
        expect(key).to.equal(web3.utils.keccak256("MetaToken"));

        key = await ctx.module.Key_SavingsManager();
        expect(key).to.equal(web3.utils.keccak256("SavingsManager"));
    });

    it("should have Nexus", async () => {
        const nexusAddr = await ctx.module.nexus();
        expect(nexusAddr).to.not.equal(ZERO_ADDRESS);

        const nexus: NexusInstance = await NexusArtifact.at(nexusAddr);

        const isInit = await nexus.initialized();
        expect(true).to.equal(isInit);
    });

    it("should have Governor address", async () => {
        const nexusAddr = await ctx.module.nexus();
        const nexus: NexusInstance = await NexusArtifact.at(nexusAddr);
        const nexusGovernor = await nexus.governor();
        expect(nexusGovernor).to.equal(sa.governor);
    });
}
