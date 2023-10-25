import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { requireConfigVariable, toplevelRun } from "../utils/helpers";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { ChainContracts, loadContracts } from "../config/contracts";
import { loadConfigFile } from "../config/BotConfig";
import { FakePriceReaderInstance } from "../../typechain-truffle";
import { defineAppConfig } from "../config/AppConfig";

const FakePriceReader = artifacts.require("FakePriceReader");
const PriceReader = artifacts.require("FtsoV1PriceReader");
const contracts: ChainContracts = loadContracts("./fasset-deployment/coston.json");
const deployerAddress = requireConfigVariable("deployer.native_address");

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
        await priceReader.setPriceFromTrustedProviders(symbol, price, { from: deployerAddress });
    });

program
    .command("getPrice")
    .description("get price")
    .argument("symbol")
    .option("-t, --trusted", "get price from trusted providers")
    .action(async (symbol: string, option) => {
        const options: { config: string } = program.opts();
        const priceReader = await initEnvironment(options.config, true);
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
    const runConfig = loadConfigFile(configFile);
    const nativePrivateKey = requireConfigVariable("deployer.native_private_key");
    const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, defineAppConfig().apiKey.native_rpc), [nativePrivateKey], null);
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
