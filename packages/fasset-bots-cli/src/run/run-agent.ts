import "dotenv/config";
import "source-map-support/register";

import { AgentBotRunner, TimeKeeperService, TimekeeperTimingConfig } from "@flarelabs/fasset-bots-core";
import { closeBotConfig, createBotConfig, loadAgentConfigFile, Secrets } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, CommandLineError, initWeb3, toBN, toBNExp, web3 } from "@flarelabs/fasset-bots-core/utils";
import BN from "bn.js";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

// We only check balance of timekeeper and submitter at start, so deposit enough funds to last for a while (only needed for gas)
// TODO: check balances and deposit continuously
const MIN_NATIVE_BALANCE = toBNExp(500, 18);

const timekeeperConfig: TimekeeperTimingConfig = {
    queryWindow: "auto",
    updateIntervalMs: 300_000,
    loopDelayMs: 5000,
    maxUnderlyingTimestampAgeS: 60,
    maxUpdateTimeDelayMs: 30_000,
}

const program = programWithCommonOptions("agent", "all_fassets");

function getAccount(secrets: Secrets, key: string) {
    const address = secrets.optional(`${key}.address`);
    const privateKey = secrets.optional(`${key}.private_key`);
    if (address && privateKey) return { address, privateKey } as const;
}

function getAccountRequired(secrets: Secrets, key: string) {
    const address = secrets.required(`${key}.address`);
    const privateKey = secrets.required(`${key}.private_key`);
    return { address, privateKey } as const;
}

async function fundAccount(from: string, to: string, minBalance: BN) {
    const balance = toBN(await web3.eth.getBalance(to));
    if (balance.lt(minBalance)) {
        await web3.eth.sendTransaction({ from: from, to: to, value: String(minBalance), gas: 100_000 });
    }
}

async function validateBalance(address: string, minBalance: BN) {
    const fromBalance = toBN(await web3.eth.getBalance(address));
    if (fromBalance.lt(minBalance)) {
        throw new CommandLineError(`Balance on owner address too small`);
    }
}

program.action(async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const options: { config: string; secrets: string } = program.opts();
        const secrets = Secrets.load(options.secrets);
        const runConfig = loadAgentConfigFile(options.config);
        const owner = getAccountRequired(secrets, "owner.native");
        const timekeeper = getAccount(secrets, "timeKeeper") ?? owner;
        const requestSubmitter = getAccount(secrets, "requestSubmitter") ?? owner;
        const walletPrivateKeys = Array.from(new Set([owner.privateKey, timekeeper.privateKey, requestSubmitter.privateKey]));
        await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), walletPrivateKeys, owner.address);
        // check balances and fund addresses so there is enough for gas
        if (timekeeper.address !== owner.address) {
            await fundAccount(owner.address, timekeeper.address, MIN_NATIVE_BALANCE);
        }
        if (requestSubmitter.address !== owner.address) {
            await fundAccount(owner.address, requestSubmitter.address, MIN_NATIVE_BALANCE);
        }
        await validateBalance(owner.address, MIN_NATIVE_BALANCE);
        //
        const botConfig = await createBotConfig("agent", secrets, runConfig, requestSubmitter.address);
        // create timekeepers
        const timekeeperService = await TimeKeeperService.create(botConfig, timekeeper.address, timekeeperConfig);
        timekeeperService.startAll();
        // create runner and agents
        const runner = await AgentBotRunner.create(secrets, botConfig, timekeeperService);
        // store owner's underlying address
        for (const ctx of runner.contexts.values()) {
            const chainName = ctx.chainInfo.chainId.chainName;
            const ownerUnderlyingAddress = secrets.required(`owner.${chainName}.address`);
            const ownerUnderlyingPrivateKey = secrets.required(`owner.${chainName}.private_key`);
            await ctx.wallet.addExistingAccount(ownerUnderlyingAddress, ownerUnderlyingPrivateKey);
        }
        // run
        try {
            console.log("Agent bot started, press CTRL+C to end");
            const stopBot = () => {
                console.log("Stopping agent bot...");
                runner.requestStop();
            }
            process.on("SIGINT", stopBot);
            process.on("SIGTERM", stopBot);
            await runner.run();
        } finally {
            await timekeeperService.stopAll();
            await closeBotConfig(botConfig);
        }
        if (runner.stopRequested) {
            break;
        } else if (runner.restartRequested) {
            console.log("Agent bot restarting...");
            continue;
        }
        break;
    }
    console.log("Agent bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
