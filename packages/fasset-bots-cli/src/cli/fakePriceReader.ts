import "dotenv/config";
import "source-map-support/register";

import chalk from "chalk";
import { getSecrets, loadConfigFile, loadContracts, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { FakePriceReaderInstance } from "@flarelabs/fasset-bots-core/types";
import { artifacts, authenticatedHttpProvider, initWeb3, requireNotNull, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";

const FakePriceReader = artifacts.require("FakePriceReader");
const PriceReader = artifacts.require("FtsoV1PriceReader");

const program = programWithCommonOptions("bot", "all_fassets");

program.name("fakePriceReader").description("Command line commands managing and reading prices on fake price reader");

program
    .command("setPrice")
    .description("set price for <symbol> to <price> for FakePriceReader")
    .argument("<symbol>", "symbol")
    .argument("<price>", "price")
    .argument("[decimals]", "decimals - required only when price not yet initialized")
    .action(async (symbol: string, price: string, decimals: string | null) => {
        await initEnvironment(true);
        const priceReader = await getPriceReader(true) as FakePriceReaderInstance;
        const deployerAddress = requireSecret("deployer.address");
        if (decimals) await priceReader.setDecimals(symbol, decimals, { from: deployerAddress });
        await priceReader.setPrice(symbol, price, { from: deployerAddress });
        await priceReader.setPriceFromTrustedProviders(symbol, price, { from: deployerAddress });
    });

program
    .command("sendEvent")
    .description("send 'PriceEcpochFinalized' event for FakePriceReader")
    .action(async () => {
        await initEnvironment(true);
        const priceReader = await getPriceReader(true) as FakePriceReaderInstance;
        const deployerAddress = requireSecret("deployer.address");
        await priceReader.finalizePrices({ from: deployerAddress });
    });

program
    .command("getPrice")
    .description("get price for <symbol> from FakePriceReader")
    .argument("symbol")
    .option("-t, --trusted", "get price from trusted providers")
    .action(async (symbol: string, option) => {
        await initEnvironment(false);
        const priceReader = await getPriceReader(true);
        if (option.trusted) {
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPriceFromTrustedProviders(symbol);
            console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
        } else {
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice(symbol);
            console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
        }
    });

program
    .command("getPriceREAL")
    .description("get price for <symbol> from PriceReader")
    .argument("symbol")
    .option("-t, --trusted", "get price from trusted providers")
    .action(async (symbol: string, option) => {
        await initEnvironment(false);
        const priceReader = await getPriceReader(false);
        if(option.trusted) {
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPriceFromTrustedProviders(symbol);
            console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
        } else {
            const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice(symbol);
            console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
        }
    });

toplevelRun(async () => {
    await program.parseAsync();
});

async function initEnvironment(requireDeployer: boolean) {
    console.log(chalk.cyan("Initializing environment..."));
    const options: { config: string } = program.opts();
    const runConfig = loadConfigFile(options.config);
    if (requireDeployer) {
        const deployerAddress = requireSecret("deployer.address");
        const deployerPrivateKey = requireSecret("deployer.private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [deployerPrivateKey], null);
        if (deployerAddress !== accounts[0]) {
            throw new Error("Invalid address/private key pair");
        }
    } else {
        await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [], null);
    }
    console.log(chalk.cyan("Environment initialized."));
}

async function getPriceReader(fakePriceReader: boolean) {
    const options: { config: string } = program.opts();
    const runConfig = loadConfigFile(options.config);
    const contracts = loadContracts(requireNotNull(runConfig.contractsJsonFile));
    if (fakePriceReader && contracts.FakePriceReader?.address) {
        return await FakePriceReader.at(contracts.FakePriceReader?.address);
    } else if (!fakePriceReader && contracts.PriceReader?.address) {
        return await PriceReader.at(contracts.PriceReader?.address);
    } else {
        throw new Error("Missing contract address");
    }
}
