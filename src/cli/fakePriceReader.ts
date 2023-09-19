import "dotenv/config";

import { Command } from "commander";
import { requireEnv, toplevelRun } from "../utils/helpers";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { ChainContracts, loadContracts } from "../config/contracts";
import { BotConfigFile } from "../config/BotConfig";
import { readFileSync } from "fs";
import { FakePriceReaderInstance } from "../../typechain-truffle";

const FakePriceReader = artifacts.require("FakePriceReader");
const PriceReader = artifacts.require("FtsoV1PriceReader");
const contracts: ChainContracts = loadContracts("../fasset/deployment/deploys/coston.json");
const deployerAddress = requireEnv("DEPLOY_ADDRESS");

const program = new Command();

program.addOption(program.createOption("-c, --config <configFile>", "Config file path (REQUIRED)").makeOptionMandatory(true));

program
    .command("setPrice")
    .description("set price")
    .argument("symbol")
    .argument("price")
    .action(async (symbol: string, price: string) => {
        const options: { config: string } = program.opts();
        const priceReader = (await initEnvironment(options.config, true)) as FakePriceReaderInstance;
        await priceReader.setPrice(symbol, price, { from: deployerAddress });
    });

program
    .command("setPriceFromTrusted")
    .description("set price from trusted providers")
    .argument("symbol")
    .argument("price")
    .action(async (symbol: string, price: string) => {
        const options: { config: string } = program.opts();
        const priceReader = (await initEnvironment(options.config, true)) as FakePriceReaderInstance;
        await priceReader.setPriceFromTrustedProviders(symbol, price, { from: deployerAddress });
    });

program
    .command("getPrice")
    .description("get price")
    .argument("symbol")
    .action(async (symbol: string) => {
        const options: { config: string } = program.opts();
        const priceReader = await initEnvironment(options.config, true);
        const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice(symbol);
        console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
    });

program
    .command("getPriceFromTrusted")
    .description("get price from trusted providers")
    .argument("symbol")
    .action(async (symbol: string) => {
        const options: { config: string } = program.opts();
        const priceReader = await initEnvironment(options.config, true);
        const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPriceFromTrustedProviders(symbol);
        console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
    });

program
    .command("getPriceREAL")
    .description("get price")
    .argument("symbol")
    .action(async (symbol: string) => {
        const options: { config: string } = program.opts();
        const priceReader = await initEnvironment(options.config, false);
        const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPrice(symbol);
        console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
    });

program
    .command("getPriceFromTrustedREAL")
    .description("get price from trusted providers")
    .argument("symbol")
    .action(async (symbol: string) => {
        const options: { config: string } = program.opts();
        const priceReader = await initEnvironment(options.config, false);
        const { 0: price, 1: timestamp, 2: decimals } = await priceReader.getPriceFromTrustedProviders(symbol);
        console.log(`Price: ${price}, Timestamp: ${timestamp}, Decimals: ${decimals}`);
    });

toplevelRun(async () => {
    await program.parseAsync();
});

async function initEnvironment(configFile: string, fakePriceReader: boolean = true) {
    const runConfig = JSON.parse(readFileSync(configFile).toString()) as BotConfigFile;
    const nativePrivateKey = requireEnv("DEPLOY_PRIVATE_KEY");
    const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, process.env.NATIVE_RPC_API_KEY), [nativePrivateKey], null);
    if (deployerAddress !== accounts[0]) {
        throw new Error("Invalid address/private key pair");
    }
    if (fakePriceReader && contracts.FakePriceReader?.address) {
        return await FakePriceReader.at(contracts.FakePriceReader?.address);
    } else if (!fakePriceReader && contracts.PriceReader?.address) {
        return await PriceReader.at(contracts.PriceReader?.address);
    } else {
        throw new Error("Missing contract address");
    }
}
