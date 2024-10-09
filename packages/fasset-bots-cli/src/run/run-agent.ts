import "dotenv/config";
import "source-map-support/register";
import { AgentBotRunner, TimeKeeperService, TimekeeperTimingConfig, PricePublisherService } from "@flarelabs/fasset-bots-core";
import { Secrets, closeBotConfig, createBotConfig, loadAgentConfigFile, createContractsMap } from "@flarelabs/fasset-bots-core/config";
import { authenticatedHttpProvider, CommandLineError, formatFixed, initWeb3, logger, sendWeb3Transaction, toBN, toBNExp, web3 } from "@flarelabs/fasset-bots-core/utils";
import BN from "bn.js";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const timekeeperConfig: TimekeeperTimingConfig = {
    queryWindow: 172800,
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
        const priceFeedApiPath = secrets.stringExistsAndIsNonZero("pricePublisher.price_feed_api_path");
        // run price publisher only if price feed api path is set
        if (priceFeedApiPath[0]) {
            const contractsMap = await createContractsMap(runConfig.contractsJsonFile as any, runConfig.pricePublisherContracts as any);
            const pricePublisherPrivateKey = secrets.required("pricePublisher.private_key");
            const pricePublisherService = new PricePublisherService(botConfig.orm.em, contractsMap, pricePublisherPrivateKey, runConfig.pricePublisherMaxDelayMs as any, priceFeedApiPath[1]);
            await pricePublisherService.run(3, 30);
        }

        // create runner and agents
        const runner = await AgentBotRunner.create(secrets, botConfig, timekeeperService);
        runner.serviceAccounts = serviceAccounts;
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
