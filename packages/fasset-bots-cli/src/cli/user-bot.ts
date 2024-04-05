import "dotenv/config";
import "source-map-support/register";

import { InfoBotCommands, PoolUserBotCommands, UserBotCommands } from "@flarelabs/fasset-bots-core";
import { Secrets } from "@flarelabs/fasset-bots-core/config";
import { formatFixed, toBN, toBNExp } from "@flarelabs/fasset-bots-core/utils";
import BN from "bn.js";
import Web3 from "web3";
import { programWithCommonOptions } from "../utils/program";
import { registerToplevelFinalizer, toplevelRun } from "../utils/toplevel";
import { translateError, validate, validateAddress, validateDecimal, validateInteger } from "../utils/validation";

const program = programWithCommonOptions("user", "single_fasset");

program.name("user-bot").description("Command line commands for FAsset user (minter, redeemer, or collateral pool provider)");

program
    .command("info")
    .description("info about the system")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const bot = await InfoBotCommands.create(options.secrets, options.config, options.fasset);
        await bot.printSystemInfo();
    });

program
    .command("agents")
    .description("Lists the available agents")
    .option("-a, --all", "print all agents, including non-public")
    .action(async (opts: { all: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const bot = await InfoBotCommands.create(options.secrets, options.config, options.fasset);
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
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        validateAddress(agentVaultAddress, "Agent vault address");
        try {
            const bot = await InfoBotCommands.create(options.secrets, options.config, options.fasset);
            await bot.printAgentInfo(agentVaultAddress);
        } catch (error) {
            translateError(error, { "invalid agent vault address": `Agent vault with address ${agentVaultAddress} does not exist` });
        }
    });

program
    .command("mint")
    .description("Mints the amount of FAssets in lots")
    .option("-a --agent <agentVaultAddress>", "agent to use for minting; if omitted, use the one with least fee that can mint required number of lots")
    .argument("<numberOfLots>")
    .option("-u, --updateBlock")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in NAT")
    .option("--noWait", "only reserve and pay for the minting, don't wait for payment finalization and proof; you have to execute the minting later")
    .action(async (numberOfLots: string, cmdOptions: { agent?: string, updateBlock?: boolean, executor?: string, executorFee?: string, noWait?: boolean }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        validateAddress(cmdOptions.agent, "Agent vault address");
        validateInteger(numberOfLots, "Number of lots", { min: 1 });
        validateAddress(cmdOptions.executor, "Executor address");
        validate(!cmdOptions.executor || !!cmdOptions.executorFee, "Option executorFee must be set when executor is set");
        validate(!cmdOptions.executorFee || !!cmdOptions.executor, "Option executor must be set when executorFee is set");
        const minterBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const agentVault = cmdOptions.agent ?? (await minterBot.infoBot().findBestAgent(toBN(numberOfLots)));
        validate(agentVault != null, "No agent with enough free lots available");
        try {
            if (cmdOptions.updateBlock) {
                await minterBot.updateUnderlyingTime();
            }
            if (cmdOptions.executor && cmdOptions.executorFee) {
                await minterBot.mint(agentVault, numberOfLots, !!cmdOptions.noWait, cmdOptions.executor, cmdOptions.executorFee);
            } else {
                await minterBot.mint(agentVault, numberOfLots, !!cmdOptions.noWait);
            }
        } catch (error) {
            translateError(error, {
                "invalid agent vault address": `Agent vault with address ${agentVault} does not exist`,
                "not enough free collateral": `Agent ${agentVault} does not have enough free collateral to accept the minting request`,
                "agent not in mint queue": `Agent ${agentVault} is not available for minting; try some other one`,
                "rc: invalid agent status": `Agent ${agentVault} is not available for minting; try some other one`,
                "agent's fee too high": `Agent ${agentVault} just changed minting fee; select an agent again`,
            });
        }
    });

program
    .command("mintExecute")
    .description("Tries to execute the minting that was paid but the execution failed")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .action(async (requestId: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const minterBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await minterBot.proveAndExecuteSavedMinting(requestId);
    });

program
    .command("mintStatus")
    .description("List all open mintings")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const minterBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await minterBot.listMintings();
    });

program
    .command("redeem")
    .description("Triggers redemption")
    .argument("<numberOfLots>")
    .option("--executor <executorAddress>", "optional executor's native address")
    .option("--executorFee <executorFee>", "optional executor's fee in NAT")
    .action(async (numberOfLots: string, cmdOptions: { executor?: string, executorFee?: string }) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        validateInteger(numberOfLots, "Number of lots", { min: 1 });
        validateAddress(cmdOptions.executor, "Executor address");
        validate(!cmdOptions.executor || !!cmdOptions.executorFee, "Option executorFee must be set when executor is set");
        validate(!cmdOptions.executorFee || !!cmdOptions.executor, "Option executor must be set when executorFee is set");
        try {
            if (cmdOptions.executor && cmdOptions.executorFee) {
                await redeemerBot.redeem(numberOfLots, cmdOptions.executor, cmdOptions.executorFee);
            } else {
                await redeemerBot.redeem(numberOfLots);
            }
        } catch (error) {
            translateError(error, {
                "f-asset balance too low": `User account does not hold ${numberOfLots} lots of ${options.fasset}`
            });
        }
    });

program
    .command("redemptionDefault")
    .description("Get paid in collateral if the agent failed to pay redemption underlying")
    .argument("<requestId>", "request id (number) or path to json file with minting data (for executors)")
    .action(async (requestId: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        try {
            await redeemerBot.savedRedemptionDefault(requestId);
        } catch (error) {
            translateError(error, {
                "redemption default too early": "Agent still has time to pay; please try redemptionDefault later if the redemption isn't paid"
            });
        }
    });

program
    .command("redemptionStatus")
    .description("List all open redemptions")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const redeemerBot = await UserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        await redeemerBot.listRedemptions();
    });

program
    .command("pools")
    .description("Print the list of pools of public agents")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const bot = await InfoBotCommands.create(options.secrets, options.config, options.fasset);
        await bot.printPools();
    });

program
    .command("poolHoldings")
    .description("Print the amount of tokens the user owns per pool")
    .action(async () => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const bot = await InfoBotCommands.create(options.secrets, options.config, options.fasset);
        const secrets = Secrets.load(options.secrets);
        const address = secrets.required("user.native.address");
        await bot.printPoolTokenBalance(address);
    });

program
    .command("enterPool")
    .description("Enter a collateral pool with specified amount of collateral")
    .argument("<poolAddressOrTokenSymbol>", "the pool the user wants to enter; can be identified by the token symbol or by the pool address")
    .argument("<collateralAmount>", "amount of collateral (FLR or SGB) to add to the pool")
    .action(async (poolAddressOrTokenSymbol: string, collateralAmount: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        validateDecimal(collateralAmount, "Collateral amount", { min: 1 }); // required at least 1 FLR to enter
        const bot = await PoolUserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const collateralAmountWei = toBNExp(collateralAmount, 18);
        const entered = await bot.enterPool(poolAddress, collateralAmountWei);
        const tokensStr = formatFixed(toBN(entered.receivedTokensWei), 18);
        console.log(`Received ${tokensStr} collateral pool tokens`);
    });

program
    .command("exitPool")
    .description("Exit a collateral pool for specified amount or all pool tokens")
    .argument("<poolAddressOrTokenSymbol>", "the pool the user wants to exit; can be identified by the token symbol or by the pool address")
    .argument("<tokenAmount>", 'the amount of collateral pool tokens to burn, can be a number or "all"')
    .action(async (poolAddressOrTokenSymbol: string, tokenAmountOrAll: string) => {
        const options: { config: string; secrets: string; fasset: string } = program.opts();
        const bot = await PoolUserBotCommands.create(options.secrets, options.config, options.fasset, registerToplevelFinalizer);
        const poolAddress = await getPoolAddress(bot, poolAddressOrTokenSymbol);
        const balance = await bot.infoBot().getPoolTokenBalance(poolAddress, bot.nativeAddress);
        let tokenAmountWei: BN;
        if (tokenAmountOrAll === "all") {
            tokenAmountWei = balance;
            validate(tokenAmountWei.gtn(0), "Collateral pool token balance is zero");
        } else {
            validateDecimal(tokenAmountOrAll, "Token amount", { strictMin: 0 });
            tokenAmountWei = toBNExp(tokenAmountOrAll, 18);
            validate(tokenAmountWei.lte(balance), `Token amount must not exceed user's balance of pool tokens, which is ${formatFixed(balance, 18)}`);
        }
        const fassetDecimals = Number(await bot.context.fAsset.decimals());
        try {
            const exited = await bot.exitPool(poolAddress, tokenAmountWei);
            const burned = formatFixed(exited.burnedTokensWei, 18);
            const collateral = formatFixed(exited.receivedNatWei, 18);
            const fassets = formatFixed(exited.receviedFAssetFeesUBA, fassetDecimals);
            const fassetSymbol = await bot.context.fAsset.symbol();
            console.log(`Burned ${burned} pool tokens.`);
            console.log(`Received ${collateral} CFLR collateral and ${fassets} ${fassetSymbol} fasset fees.`);
        } catch (error) {
            translateError(error, {
                "token share is zero": "Token amount must be greater than 0",
                "token balance too low": `Token amount must not exceed user's balance of pool tokens, which is ${formatFixed(balance, 18)}`,
                "collateral ratio falls below exitCR": `Cannot exit pool at this time, since it would reduce the collateral ratio to dangerously low level; try with lower token amount`,
                "collateral left after exit is too low and non-zero": `Should not exit with nearly all tokens - use "all" for token amount`,
                "insufficient non-timelocked balance": "You cannot exit pool immediately after entering, please wait a minute",
            });
        }
    });

async function getPoolAddress(bot: PoolUserBotCommands, poolAddressOrTokenSymbol: string) {
    return Web3.utils.isAddress(poolAddressOrTokenSymbol)
        ? poolAddressOrTokenSymbol
        : await bot.infoBot().findPoolBySymbol(poolAddressOrTokenSymbol);
}

toplevelRun(async () => {
    try {
        await program.parseAsync();
    } catch (error) {
        translateError(error, {
            "invalid agent vault address": "Agent vault with given address does not exist",
            "insufficient funds for gas * price + value": "User account does not heave enough CFLR",
        });
    }
});
