import "dotenv/config";

import { readFileSync } from "fs";
import { AgentBotRunner } from "../actors/AgentBotRunner";
import { BotConfigFile, createBotConfig } from "../config/BotConfig";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { disableMccTraceManager } from "../../test-hardhat/test-utils/helpers";

const OWNER_ADDRESS: string = requireEnv("OWNER_ADDRESS");
const OWNER_PRIVATE_KEY: string = requireEnv("OWNER_PRIVATE_KEY");
const OWNER_UNDERLYING_ADDRESS: string = requireEnv("OWNER_UNDERLYING_ADDRESS");
const OWNER_UNDERLYING_PRIVATE_KEY: string = requireEnv("OWNER_UNDERLYING_PRIVATE_KEY");
const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");

toplevelRun(async () => {
    // to avoid RangeError: Map maximum size exceeded in /home/fasset-bots/simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace.js:18:44
    disableMccTraceManager();
    const runConfig = JSON.parse(readFileSync(RUN_CONFIG_PATH).toString()) as BotConfigFile;
    await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, process.env.NATIVE_RPC_API_KEY), [OWNER_PRIVATE_KEY], null);
    const botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
    // create runner and agents
    const runner = await AgentBotRunner.create(botConfig);
    // store owner's underlying address
    for (const ctxMap of runner.contexts) {
        await ctxMap[1].wallet.addExistingAccount(OWNER_UNDERLYING_ADDRESS, OWNER_UNDERLYING_PRIVATE_KEY);
    }
    // run
    console.log("Agent bot started, press CTRL+C to end");
    process.on("SIGINT", () => {
        console.log("Stopping agent bot...");
        runner.requestStop();
    });
    await runner.run();
    console.log("Agent bot stopped");
});
