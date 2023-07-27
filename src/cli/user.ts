import { Command } from 'commander';
import { toplevelRun } from '../utils/helpers';
import { UserBot } from '../actors/UserBot';

const program = new Command();

program
    .addOption(program.createOption("-c, --config <configFile>", "Config file path (REQUIRED)").makeOptionMandatory(true))
    .addOption(program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query").makeOptionMandatory(true));

program.command("agents")
    .description("Lists the available agents")
    .action(async () => {
        const options: { config: string, fasset: string } = program.opts();
        const bot = new UserBot();
        await bot.initialize(options.config, options.fasset);
        const agents = await bot.getAvailableAgents();
        console.log(`${"ADDRESS".padEnd(42)}  ${"MAX_LOTS".padEnd(8)}  ${"FEE".padEnd(6)}`)
        for (const agent of agents) {
            const lots = String(agent.freeCollateralLots);
            const fee = Number(agent.feeBIPS) / 100;
            console.log(`${agent.agentVault.padEnd(42)}  ${lots.padStart(8)}  ${fee.toFixed(2).padStart(5)}%`);
        }
    });

program.command("mint")
    .description("Mints the amount of FAssets in lots")
    .argument("<agentVaultAddress>")
    .argument("<amountLots>")
    .option('-u, --updateBlock')
    .action(async (agentVault: string, amountLots: string) => {
        const options: { config: string, fasset: string, updateBlock: boolean | undefined } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset);
        if (options.updateBlock) {
            await minterBot.updateUnderlyingTime();
        }
        await minterBot.mint(agentVault, amountLots);
    });

program.command("mintExecute")
    .description("Tries to execute the minting that was paid but the execution failed")
    .argument("<collateralReservationId>")
    .argument("<paymentAddress>")
    .argument("<transactionHash>")
    .action(async (collateralReservationId: string, paymentAddress: string, transactionHash: string) => {
        const options: { config: string, fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset);
        await minterBot.proveAndExecuteMinting(collateralReservationId, paymentAddress, transactionHash);
    });

program.command("redeem")
    .description("Triggers redemption")
    .argument("<amountLots>")
    .action(async (amountLots: string) => {
        const options: { config: string, fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset);
        await redeemerBot.redeem(amountLots);
    });

program.command("redemptionDefault")
    .description("Get paid in collateral if the agent failed to pay redemption underlying")
    .argument("<amount>")
    .argument("<reference>")
    .argument("<firstBlock>")
    .argument("<lastBlock>")
    .argument("<lastTs>")
    .action(async (amountUBA: string, paymentReference: string, firstUnderlyingBlock: string, lastUnderlyingBlock: string, lastUnderlyingTimestamp: string) => {
        const options: { config: string, fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset);
        await redeemerBot.redemptionDefault(amountUBA, paymentReference, firstUnderlyingBlock, lastUnderlyingBlock, lastUnderlyingTimestamp);
    });

toplevelRun(async () => {
    await program.parseAsync();
});