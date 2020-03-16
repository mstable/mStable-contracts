import { StandardAccounts } from "@utils/machines";
import { ModuleInstance, NexusInstance } from "types/generated";

const NexusArtifact = artifacts.require("Nexus");
const { ZERO_ADDRESS } = require("@utils/constants");

export default function shouldBehaveLikeModule(
    ctx: { module: ModuleInstance },
    sa: StandardAccounts,
) {

    it("should have all ModuleKeys initialized", async () =>{
        let key: string;
        key = await ctx.module.Key_Governance();

        expect(key).to.equal(web3.utils.keccak256("Governance"));

        // TODO add further after testing above line.
        key = await ctx.module.Key_Staking();
        key = await ctx.module.Key_OracleHub();
        key = await ctx.module.Key_Manager();
        key = await ctx.module.Key_Recollateraliser();
        key = await ctx.module.Key_MetaToken();
        key = await ctx.module.Key_SavingsManager();
        
    });

    it("should have Nexus", async () => {
        const nexusAddr = await ctx.module.nexus();
        expect(nexusAddr).to.not.equal(ZERO_ADDRESS);

        const nexus: NexusInstance = NexusArtifact.at(nexusAddr);    
        // Ensure at least Nexus is initialized
        const isInit = await nexus.initialized();
        expect(isInit).to.equal(true);

    });
    
    it("should have Governor address", async () => {
        const nexusAddr = await ctx.module.nexus();
        const nexus: NexusInstance = NexusArtifact.at(nexusAddr);    
        const nexusGovernor = await nexus.governor();
        expect(nexusGovernor).to.equal(sa.governor);
    });
}