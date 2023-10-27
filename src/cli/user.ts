import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { toplevelRun } from "../utils/helpers";
import { UserBot } from "../actors/UserBot";
import { logger } from "../utils/logger";

const program = new Command();

program
    .addOption(
        program
            .createOption("-c, --config <configFile>", "Config file path (if not provided, environment variable USER_CONFIG_PATH is required)")
            .env("USER_CONFIG_PATH")
            .makeOptionMandatory(true)
    )
    .addOption(program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query").makeOptionMandatory(true));

program
    .command("agents")
    .description("Lists the available agents")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = new UserBot();
        await bot.initialize(options.config, options.fasset);
        logger.info(`User ${bot.nativeAddress} started fetching available agents.`);
        const agents = await bot.getAvailableAgents();
        console.log(`${"ADDRESS".padEnd(42)}  ${"MAX_LOTS".padEnd(8)}  ${"FEE".padEnd(6)}`);
        let loggedAgents = ``;
        for (const agent of agents) {
            const lots = String(agent.freeCollateralLots);
            const fee = Number(agent.feeBIPS) / 100;
            console.log(`${agent.agentVault.padEnd(42)}  ${lots.padStart(8)}  ${fee.toFixed(2).padStart(5)}%`);
            loggedAgents =
                loggedAgents + `User ${bot.nativeAddress} fetched agent: ${agent.agentVault.padEnd(42)}  ${lots.padStart(8)}  ${fee.toFixed(2).padStart(5)}%\n`;
        }
        logger.info(loggedAgents);
        logger.info(`User ${bot.nativeAddress} finished fetching available agents.`);
    });

program
    .command("mint")
    .description("Mints the amount of FAssets in lots")
    .argument("<agentVaultAddress>")
    .argument("<amountLots>")
    .option("-u, --updateBlock")
    .action(async (agentVault: string, amountLots: string) => {
        const options: { config: string; fasset: string; updateBlock: boolean | undefined } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset);
        if (options.updateBlock) {
            await minterBot.updateUnderlyingTime();
        }
        await minterBot.mint(agentVault, amountLots);
    });

program
    .command("mintExecute")
    .description("Tries to execute the minting that was paid but the execution failed")
    .argument("<collateralReservationId>")
    .argument("<transactionHash>")
    .argument("<paymentAddress>")
    .action(async (collateralReservationId: string, transactionHash: string, paymentAddress: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset);
        await minterBot.proveAndExecuteMinting(collateralReservationId, transactionHash, paymentAddress);
    });

program
    .command("redeem")
    .description("Triggers redemption")
    .argument("<amountLots>")
    .action(async (amountLots: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset);
        await redeemerBot.redeem(amountLots);
    });

program
    .command("redemptionDefault")
    .description("Get paid in collateral if the agent failed to pay redemption underlying")
    .argument("<amount>")
    .argument("<reference>")
    .argument("<firstBlock>")
    .argument("<lastBlock>")
    .argument("<lastTs>")
    .action(async (amountUBA: string, paymentReference: string, firstUnderlyingBlock: string, lastUnderlyingBlock: string, lastUnderlyingTimestamp: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset);
        await redeemerBot.redemptionDefault(amountUBA, paymentReference, firstUnderlyingBlock, lastUnderlyingBlock, lastUnderlyingTimestamp);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
