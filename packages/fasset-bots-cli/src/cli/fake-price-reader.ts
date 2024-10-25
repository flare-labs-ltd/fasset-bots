import "dotenv/config";
import "source-map-support/register";

import { Secrets, loadConfigFile, loadContracts } from "@flarelabs/fasset-bots-core/config";
import { FakePriceReaderInstance } from "@flarelabs/fasset-bots-core/types";
import { artifacts, authenticatedHttpProvider, initWeb3, requireNotNull } from "@flarelabs/fasset-bots-core/utils";
import chalk from "chalk";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";

const FakePriceReader = artifacts.require("FakePriceReader");
const PriceReader = artifacts.require("FtsoV1PriceReader");

const program = programWithCommonOptions("util", "all_fassets");

program.name("fake-price-reader").description("Command line commands managing and reading prices on fake price reader");

program
    .command("setPrice")
    .description("set price for <symbol> to <price> for FakePriceReader")
    .argument("<symbol>", "symbol")
    .argument("<price>", "price")
    .argument("[decimals]", "decimals - required only when price not yet initialized")
    .action(async (symbol: string, price: string, decimals: string | null) => {
        const secrets = await Secrets.load(program.opts().secrets);
        await initEnvironment(secrets, true);
        const priceReader = (await getPriceReader(true)) as FakePriceReaderInstance;
        const deployerAddress = secrets.required("deployer.address");
        if (decimals) await priceReader.setDecimals(symbol, decimals, { from: deployerAddress });
        await priceReader.setPrice(symbol, price, { from: deployerAddress });
        await priceReader.setPriceFromTrustedProviders(symbol, price, { from: deployerAddress });
    });

program
    .command("sendEvent")
    .description("send 'PriceEcpochFinalized' event for FakePriceReader")
    .action(async () => {
        const secrets = await Secrets.load(program.opts().secrets);
        await initEnvironment(secrets, true);
        const priceReader = (await getPriceReader(true)) as FakePriceReaderInstance;
        const deployerAddress = secrets.required("deployer.address");
        await priceReader.finalizePrices({ from: deployerAddress });
    });

program
    .command("getPrice")
    .description("get price for <symbol> from FakePriceReader")
    .argument("symbol")
    .option("-t, --trusted", "get price from trusted providers")
    .action(async (symbol: string, option) => {
        const secrets = await Secrets.load(program.opts().secrets);
        await initEnvironment(secrets, false);
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
        const secrets = await Secrets.load(program.opts().secrets);
        await initEnvironment(secrets, false);
        const priceReader = await getPriceReader(false);
        if (option.trusted) {
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

async function initEnvironment(secrets: Secrets, requireDeployer: boolean) {
    console.log(chalk.cyan("Initializing environment..."));
    const options: { config: string } = program.opts();
    const runConfig = loadConfigFile(options.config);
    if (requireDeployer) {
        const deployerAddress = secrets.required("deployer.address");
        const deployerPrivateKey = secrets.required("deployer.private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [deployerPrivateKey], null);
        if (deployerAddress !== accounts[0]) {
            throw new Error("Invalid address/private key pair");
        }
    } else {
        await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, secrets.optional("apiKey.native_rpc")), [], null);
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
