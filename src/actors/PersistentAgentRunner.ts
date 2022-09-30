import Web3 from "web3";
import { createAssetContext } from "../../test/integration/test-config";
import { BotConfig } from "../config/BotConfig";
import { PersistenceContext } from "../config/PersistenceContext";
import { IAssetContext } from "../fasset/IAssetContext";
import { web3 } from "../utils/web3";
import { AgentEntity } from "./entities";
import { PersistentAgent } from "./PersistentAgent";

export class PersistentAgentRunner {
    constructor(
        public context: IAssetContext,
        public pc: PersistenceContext,
    ) { }

    async run() {
        while (true) {
            this.pc.em = this.pc.orm.em.fork();
            await this.runStep();
        }
    }

    async runStep() {
        const agentEntities = await this.pc.em.find(AgentEntity, { active: true });
        for (const agentEntity of agentEntities) {
            try {
                const agent = await PersistentAgent.load(this.pc, this.context, agentEntity);
                await agent.handleEvents();
                await agent.handleOpenRedemptions();
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}`, error);
            }
        }
    }
    
    static async createAndRun(botConfig: BotConfig) {
        web3.setProvider(new Web3.providers.HttpProvider(botConfig.rpcUrl));
        const rootPc = await PersistenceContext.create();
        const runners: Promise<void>[] = [];
        for (const chainConfig of botConfig.chains) {
            const assetContext = await createAssetContext(botConfig, chainConfig);
            const pc = rootPc.clone();
            const chainRunner = new PersistentAgentRunner(assetContext, pc);
            runners.push(chainRunner.run());
        }
        await Promise.all(runners);
    }
}
