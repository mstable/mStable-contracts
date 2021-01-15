/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable spaced-comment */
/* eslint-disable @typescript-eslint/triple-slash-reference,spaced-comment */
/// <reference path="../../types/generated/index.d.ts" />
/// <reference path="../../types/generated/types.d.ts" />

export default async (
    { artifacts }: { artifacts: Truffle.Artifacts },
    deployer,
    network,
    accounts,
): Promise<void> => {
    if (deployer.network === "fork") {
        // Don't bother running these migrations -- speed up the testing
        return;
    }

    const [default_] = accounts;

    const c_Proxy = artifacts.require("InitializableProxy");
    const c_SavingsContract = artifacts.require("SavingsContract");
    const c_BoostedSavingsVault = artifacts.require("BoostedSavingsVault");

    const addr_nexus = "";
    const addr_poker = default_;
    const addr_mUSD = "";
    const addr_proxyadmin = "";
    const addr_MTA = "";
    const addr_vMTA = "";
    const addr_rewards_distributor = "";

    if (deployer.network === "ropsten") {
        // Savings Contract
        const s_proxy = await c_Proxy.new();
        const s_impl = await c_SavingsContract.new();
        const s_data: string = s_impl.contract.methods
            .initialize(
                addr_nexus, // const
                addr_poker,
                addr_mUSD, // const
                "Interest bearing mUSD", // const
                "imUSD", // const
            )
            .encodeABI();
        await s_proxy.methods["initialize(address,address,bytes)"](
            s_impl.address,
            addr_proxyadmin,
            s_data,
        );
        // Savings Vault
        const v_proxy = await c_Proxy.new();
        const v_impl = await c_BoostedSavingsVault.new();
        const v_data: string = v_impl.contract.methods
            .initialize(
                addr_nexus, // const
                s_proxy.address, // const
                addr_vMTA, // const
                addr_MTA, // const
                addr_rewards_distributor,
            )
            .encodeABI();
        await v_proxy.methods["initialize(address,address,bytes)"](
            v_impl.address,
            addr_proxyadmin,
            v_data,
        );

        // TODO:
        //  - Verify deployment
        //  - Fund pool
        //  - Update in SavingsManager

        console.log(`[SavingsContract | imUSD]: '${s_proxy.address}'`);
        console.log(`[BoostedSavingsVault]: '${v_proxy.address}'`);
    }
};
