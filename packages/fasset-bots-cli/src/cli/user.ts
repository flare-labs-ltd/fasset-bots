import "dotenv/config";
import "source-map-support/register";

import { InfoBot, UserBot } from "@flarelabs/fasset-bots-core";
import { requireSecret } from "@flarelabs/fasset-bots-core/config";
import { CommandLineError, minBN, toBN, toBNExp, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import Web3 from "web3";
import { programWithCommonOptions } from "../utils/program";

const program = programWithCommonOptions("user", "single_fasset");

program.name("user-bot").description("Command line commands for FAsset user (minter, redeemer, or collateral pool provider)");

program
    .command("info")
    .description("info about the system")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        await bot.printSystemInfo();
    });

program
    .command("agents")
    .description("Lists the available agents")
    .option("-a, --all", "print all agents, including non-public")
    .action(async (opts: { all: boolean }) => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        if (opts.all) {
            await bot.printAllAgents();
        } else {
            await bot.printAvailableAgents();
        }
    });

program
    .command("agentInfo")
    .description("info about an agent")
    .argument("<agentVaultAddress>", "the address of the agent vault")
    .action(async (agentVaultAddress: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        await bot.printAgentInfo(agentVaultAddress);
    });

program
    .command("mint")
    .description("Mints the amount of FAssets in lots")
    .option("-a --agent <agentVaultAddress>", "agent to use for minting; if omitted, use the one with least fee that can mint required number of lots")
    .argument("<amountLots>")
    .option("-u, --updateBlock")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in NAT")
    .option("--noWait", "only reserve and pay for the minting, don't wait for payment finalization and proof; you have to execute the minting later")
    .action(async (amountLots: string, cmdOptions: { agent?: string, updateBlock?: boolean, executor?: string, executorFee?: string, noWait?: boolean }) => {
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset, true);
        const agentVault = cmdOptions.agent ?? (await minterBot.infoBot().findBestAgent(toBN(amountLots)));
        if (agentVault == null) {
            throw new CommandLineError("No agent with enough free lots available");
        }
        if (cmdOptions.updateBlock) {
            await minterBot.updateUnderlyingTime();
        }
        if (cmdOptions.executor && !cmdOptions.executorFee) {
            throw new CommandLineError("Missing executorFee");
        }
        if (!cmdOptions.executor && cmdOptions.executorFee) {
            throw new CommandLineError("Missing executor address");
        }
        if (cmdOptions.executor && cmdOptions.executorFee) {
            await minterBot.mint(agentVault, amountLots, !!cmdOptions.noWait, cmdOptions.executor, cmdOptions.executorFee);
        } else {
            await minterBot.mint(agentVault, amountLots, !!cmdOptions.noWait);
        }
    });

program
    .command("mintExecute")
    .description("Tries to execute the minting that was paid but the execution failed")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .action(async (requestId: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset, true);
        await minterBot.proveAndExecuteSavedMinting(requestId);
    });

program
    .command("mintStatus")
    .description("List all open mintings")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const minterBot = await UserBot.create(options.config, options.fasset, false);
        await minterBot.listMintings();
    });

program
    .command("redeem")
    .description("Triggers redemption")
    .argument("<amountLots>")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in NAT")
    .action(async (amountLots: string, cmdOptions: { executorAddress?: string, executorFee?: string }) => {
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset, true);
        if (cmdOptions.executorAddress && !cmdOptions.executorFee) {
            throw new CommandLineError("Missing executorFee");
        }
        if (!cmdOptions.executorAddress && cmdOptions.executorFee) {
            throw new CommandLineError("Missing executorAddress");
        }
        if (cmdOptions.executorAddress && cmdOptions.executorFee) {
            await redeemerBot.redeem(amountLots, cmdOptions.executorAddress, cmdOptions.executorFee);
        } else {
            await redeemerBot.redeem(amountLots);
        }
    });

program
    .command("redemptionDefault")
    .description("Get paid in collateral if the agent failed to pay redemption underlying")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .action(async (requestId: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset, true);
        await redeemerBot.savedRedemptionDefault(requestId);
    });

program
    .command("redemptionStatus")
    .description("List all open redemptions")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const redeemerBot = await UserBot.create(options.config, options.fasset, true);
        await redeemerBot.listRedemptions();
    });

program
    .command("pools")
    .description("Print the list of pools of public agents")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        await bot.printPools();
    });

program
    .command("poolHoldings")
    .description("Print the amount of tokens the user owns per pool")
    .action(async () => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await InfoBot.create(options.config, options.fasset);
        const address = requireSecret("user.native.address");
        await bot.printPoolTokenBalance(address);
    });

program
    .command("enterPool")
    .description("Enter a collateral pool with specified amount of collateral")
    .argument("<poolAddressOrTokenSymbol>")
    .argument("<collateralAmount>", "amount of collateral (FLR or SGB) to add to the pool")
    .action(async (poolAddressOrTokenSymbol: string, collateralAmount: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await UserBot.create(options.config, options.fasset, false);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const collateralAmountWei = toBNExp(collateralAmount, 18);
        const entered = await bot.enterPool(poolAddress, collateralAmountWei);
        const tokens = Number(entered.receivedTokensWei) / 1e18;
        console.log(`Received ${tokens.toFixed(2)} collateral pool tokens`);
    });

program
    .command("exitPool")
    .description("Exit a collateral pool for specified amount or all pool tokens")
    .argument("<poolAddressOrTokenSymbol>")
    .argument("<amount>", 'the amount of tokens to burn, can be a number or "all"')
    .action(async (poolAddressOrTokenSymbol: string, tokenAmountOrAll: string) => {
        const options: { config: string; fasset: string } = program.opts();
        const bot = await UserBot.create(options.config, options.fasset, false);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const balance = await bot.infoBot().getPoolTokenBalance(poolAddress, bot.nativeAddress);
        const tokenAmountWei = tokenAmountOrAll === "all" ? balance : minBN(toBNExp(tokenAmountOrAll, 18), balance);
        const exited = await bot.exitPool(poolAddress, tokenAmountWei);
        const burned = Number(exited.burnedTokensWei) / 1e18;
        const collateral = Number(exited.receivedNatWei) / 1e18;
        const fassets = Number(exited.receviedFAssetFeesUBA) / 10 ** Number(await bot.context.fAsset.decimals());
        const fassetSymbol = await bot.context.fAsset.symbol();
        console.log(`Burned ${burned.toFixed(2)} pool tokens.`);
        console.log(`Received ${collateral.toFixed(2)} CFLR collateral and ${fassets.toFixed(2)} ${fassetSymbol} fasset fees.`);
    });

async function getPoolAddress(bot: UserBot, poolAddressOrTokenSymbol: string) {
    return Web3.utils.isAddress(poolAddressOrTokenSymbol) ? poolAddressOrTokenSymbol : await bot.infoBot().findPoolBySymbol(poolAddressOrTokenSymbol);
}

toplevelRun(async () => {
    await program.parseAsync();
});
