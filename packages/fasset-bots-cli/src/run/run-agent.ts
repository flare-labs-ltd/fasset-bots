import "dotenv/config";
import "source-map-support/register";

import { ActivityTimestampEntity, AgentBotRunner, PricePublisherService, promptForPassword, TimeKeeperService, TimekeeperTimingConfig } from "@flarelabs/fasset-bots-core";
import { closeBotConfig, createBotConfig, EM, loadAgentConfigFile, Secrets } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, CommandLineError, formatFixed, initWeb3, isNotNull, logger, sendWeb3Transaction, toBN, toBNExp, web3 } from "@flarelabs/fasset-bots-core/utils";
import BN from "bn.js";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { readFileSync } from "fs";

const timekeeperConfig: TimekeeperTimingConfig = {
    queryWindow: 172800,
    updateIntervalMs: 300_000,
    loopDelayMs: 5000,
    maxUnderlyingTimestampAgeS: 60,
    maxUpdateTimeDelayMs: 30_000,
}

let activityUpdateTimer: NodeJS.Timeout | null = null;
const activityUpdateInterval = 60000; // 1min

const program = programWithCommonOptions("agent", "all_fassets");

function getAccount(secrets: Secrets, key: string) {
    const address = secrets.optional(`${key}.address`);
    const privateKey = secrets.optional(`${key}.private_key`);
    if (address && privateKey) return { address, privateKey };
}

function getAccountRequired(secrets: Secrets, key: string) {
    const address = secrets.required(`${key}.address`);
    const privateKey = secrets.required(`${key}.private_key`);
    return { address, privateKey };
}

async function fundAccount(from: string, to: string, minBalance: BN, name: string) {
    const balance = toBN(await web3.eth.getBalance(to));
    if (balance.lt(minBalance)) {
        const transferBalance = minBalance.muln(2);
        console.log(`Transfering ${formatFixed(transferBalance, 18)} native tokens to ${name} (${to}) for gas...`);
        await sendWeb3Transaction({ from: from, to: to, value: String(transferBalance), gas: 100_000 });
    }
}

async function validateBalance(address: string, minBalance: BN) {
    const fromBalance = toBN(await web3.eth.getBalance(address));
    if (fromBalance.lt(minBalance)) {
        throw new CommandLineError(`Balance on owner address too small`);
    }
}

async function activityTimestampUpdate(rootEm: EM) {
    await rootEm.transactional(async (em) => {
        let stateEnt = await em.findOne(ActivityTimestampEntity, {id: 1});
        if (!stateEnt) {
            stateEnt = new ActivityTimestampEntity();
        } else {
            stateEnt.lastActiveTimestamp = toBN(Math.floor((new Date()).getTime() / 1000));
        }
        await em.persistAndFlush(stateEnt);
    }).catch(error => {
        logger.error("Error updating timestamp:", error);
        console.error("Error updating timestamp:", error);
    });
}

function startTimestampUpdater(rootEm: EM) {
    void activityTimestampUpdate(rootEm);
    activityUpdateTimer = setInterval(() => void activityTimestampUpdate(rootEm), activityUpdateInterval);
}

program.action(async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const options: { config: string; secrets: string } = program.opts();
        const secrets = await Secrets.load(options.secrets);
        const runConfig = loadAgentConfigFile(options.config);
        const owner = getAccountRequired(secrets, "owner.native");
        const timekeeper = getAccount(secrets, "timeKeeper") ?? owner;
        const requestSubmitter = getAccount(secrets, "requestSubmitter") ?? owner;
        const pricePublisher = getAccount(secrets, "pricePublisher") ?? null;
        const walletPrivateKeys = Array.from(new Set([owner.privateKey, timekeeper.privateKey, requestSubmitter.privateKey, pricePublisher?.privateKey])).filter(isNotNull);
        await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), walletPrivateKeys, owner.address);
        // check balances and fund addresses so there is enough for gas
        const minNativeBalance = toBNExp(runConfig.agentBotSettings.minBalanceOnServiceAccount, 18);
        const serviceAccounts = new Map<string, string>();
        if (timekeeper.address !== owner.address) {
            await fundAccount(owner.address, timekeeper.address, minNativeBalance, "timekeeper");
            serviceAccounts.set("timekeeper", timekeeper.address);
        }
        if (requestSubmitter.address !== owner.address) {
            await fundAccount(owner.address, requestSubmitter.address, minNativeBalance, "request submitter");
            serviceAccounts.set("request submitter", requestSubmitter.address);
        }
        await validateBalance(owner.address, minNativeBalance);
        //
        const botConfig = await createBotConfig("agent", secrets, runConfig, requestSubmitter.address);
        logger.info(`Asset manager controller is ${botConfig.contractRetriever.assetManagerController.address}.`);
        // create timekeepers
        const timekeeperService = await TimeKeeperService.create(botConfig, timekeeper.address, timekeeperConfig);
        timekeeperService.startAll();
        // run price publisher only if price feed api path is set
        let pricePublisherService: PricePublisherService | null = null;
        if (runConfig.priceFeedApiUrls && pricePublisher) {
            if (pricePublisher.address !== owner.address) {
                await fundAccount(owner.address, pricePublisher.address, minNativeBalance, "price publisher");
                serviceAccounts.set("price publisher", pricePublisher.address);
            }
            pricePublisherService = await PricePublisherService.create(runConfig, secrets, pricePublisher.address);
            pricePublisherService.start();
        }
        // create runner and agents
        const runner = await AgentBotRunner.create(secrets, botConfig, timekeeperService);
        runner.serviceAccounts = serviceAccounts;
        // store owner's underlying address and start running wallets
        const runningWalletBySymbol: string[] = [];
        for (const ctx of runner.contexts.values()) {
            const chainName = ctx.chainInfo.chainId.chainName;
            const ownerUnderlyingAddress = secrets.required(`owner.${chainName}.address`);
            const ownerUnderlyingPrivateKey = secrets.required(`owner.${chainName}.private_key`);
            await ctx.wallet.addExistingAccount(ownerUnderlyingAddress, ownerUnderlyingPrivateKey);
        }
        // start activity update
        void startTimestampUpdater(botConfig.orm.em);
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
            if (pricePublisherService) {
                await pricePublisherService.stop();
            }
            if (activityUpdateTimer) {
                clearInterval(activityUpdateTimer);
                logger.info("Activity update timer was cleared.");
                console.log("Activity update timer was cleared.");
            }
            await timekeeperService.stopAll();
            await closeBotConfig(botConfig);
        }
        if (runner.stopRequested) {
            break;
        }
        break;
    }
    console.log("Agent bot stopped");
});

toplevelRun(async () => {
    await program.parseAsync();
});
