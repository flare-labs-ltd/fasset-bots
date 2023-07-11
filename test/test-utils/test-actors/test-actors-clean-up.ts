import { readFileSync } from "fs";
import { AgentBotConfig, AgentBotRunConfig, createAgentBotConfig } from "../../../src/config/BotConfig";
import { ORM } from "../../../src/config/orm";
import { IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { COSTON_RPC, COSTON_RUN_CONFIG_CONTRACTS } from "../test-bot-config";
import { createAssetContext } from "../../../src/config/create-asset-context";
import { initWeb3 } from "../../../src/utils/web3";
import { getNativeAccountsFromEnv, cleanUp } from "../test-helpers";

describe("Agent bot tests - coston", async () => {
    let accounts: string[];
    let botConfig: AgentBotConfig;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let runConfig: AgentBotRunConfig;

    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createAgentBotConfig(runConfig);
        orm = botConfig.orm;
        context = await createAssetContext(botConfig, botConfig.chains[0]);
    });

    it("Should destroy agents on coston created by 'owner'", async () => {
        await cleanUp(context, orm, ownerAddress);
    });

});