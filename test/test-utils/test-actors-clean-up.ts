import { readFileSync } from "fs";
import { AgentBotConfig, AgentBotRunConfig, createAgentBotConfig } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { IAssetAgentBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { requireEnv } from "../../src/utils/helpers";
import { COSTON_RUN_CONFIG_CONTRACTS } from "./test-bot-config";
import { cleanUp, getNativeAccountsFromEnv } from "./test-actors";
import { createAssetContext } from "../../src/config/create-asset-context";
import { initWeb3 } from "../../src/utils/web3";

const RPC_URL: string = requireEnv('RPC_URL');

describe("Agent bot tests - coston", async () => {
    let accounts: string[];
    let botConfig: AgentBotConfig;
    let context: IAssetAgentBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let runConfig: AgentBotRunConfig;

    before(async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_CONTRACTS).toString()) as AgentBotRunConfig;
        accounts = await initWeb3(RPC_URL, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createAgentBotConfig(runConfig);
        orm = botConfig.orm;
        context = await createAssetContext(botConfig, botConfig.chains[0]);
    });

    it("Should destroy agents on coston created by 'owner'", async () => {
        await cleanUp(context, orm, ownerAddress);
    });

});