import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { ChainContracts, loadContracts } from "../config/contracts";
import { loadConfigFile } from "../config/BotConfig";
import { FakePriceReaderInstance } from "../../typechain-truffle";
import { getSecrets } from "../config/secrets";
import chalk from "chalk";

const FakePriceReader = artifacts.require("FakePriceReader");
const PriceReader = artifacts.require("FtsoV1PriceReader");
const contracts: ChainContracts = loadContracts("./fasset-deployment/coston.json");
const deployerAddress = requireSecret("deployer.address");
const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");

const program = new Command();

program
    .command("setPrice")
    .description("set price for <symbol> to <price> for FakePriceReader")
    .argument("<symbol>", "symbol")
    .argument("<price>", "price")
    .argument("[decimals]", "decimals - required only when price not yet initialized")
    .action(async (symbol: string, price: string, decimals: string | null) => {
        const priceReader = (await initEnvironment(true)) as FakePriceReaderInstance;
        if (decimals) await priceReader.setDecimals(symbol, decimals, { from: deployerAddress });
        await priceReader.setPrice(symbol, price, { from: deployerAddress });
        await priceReader.setPriceFromTrustedProviders(symbol, price, { from: deployerAddress });
    });

program
    .command("sendEvent")
    .description("send 'PriceEcpochFinalized' event for FakePriceReader")
    .action(async () => {
        const priceReader = (await initEnvironment(true)) as FakePriceReaderInstance;
        await priceReader.finalizePrices({ from: deployerAddress });
    });

program
    .command("getPrice")
    .description("get price for <symbol> from FakePriceReader")
    .argument("symbol")
    .option("-t, --trusted", "get price from trusted providers")
    .action(async (symbol: string, option) => {
        const priceReader = await initEnvironment(true);
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
        const priceReader = await initEnvironment(false);
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

async function initEnvironment(fakePriceReader: boolean = true) {
    console.log(chalk.cyan("Initializing environment..."));
    const configFile: string = RUN_CONFIG_PATH;
    const runConfig = loadConfigFile(configFile);
    const nativePrivateKey = requireSecret("deployer.private_key");
    const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [nativePrivateKey], null);
    if (deployerAddress !== accounts[0]) {
        throw new Error("Invalid address/private key pair");
    }
    if (fakePriceReader && contracts.FakePriceReader?.address) {
        console.log(chalk.cyan("Environment initialized."));
        return await FakePriceReader.at(contracts.FakePriceReader?.address);
    } else if (!fakePriceReader && contracts.PriceReader?.address) {
        console.log(chalk.cyan("Environment initialized."));
        return await PriceReader.at(contracts.PriceReader?.address);
    } else {
        throw new Error("Missing contract address");
    }
}
