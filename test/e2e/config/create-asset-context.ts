import { expect } from "chai";
import { readFileSync } from "fs";
import { BotConfig, createBotConfig, RunConfig } from "../../../src/config/BotConfig"
import { createAssetContext } from "../../../src/config/create-asset-context";
import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { getCoston2AccountsFromEnv } from "../../utils/test-actors";
import { COSTON2_RUN_CONFIG_ADDRESS_UPDATER, COSTON2_RUN_CONFIG_CONTRACTS } from "../../utils/test-bot-config";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require("chai");
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

const OWNER_ADDRESS: string = requireEnv('OWNER_ADDRESS');

describe("Create asset context tests", async () => {
    let runConfig: RunConfig;
    let accounts: string[];
    let ownerAddress: string;
    let botConfig: BotConfig;

    it("Should create asset context from contracts", async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        accounts = await initWeb3(runConfig.rpcUrl, getCoston2AccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        const context: IAssetBotContext = await createAssetContext(botConfig, botConfig.chains[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.chains[0].chainInfo.chainId);
    });

    it("Should create asset context from address updater", async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_ADDRESS_UPDATER).toString()) as RunConfig;
        accounts = await initWeb3(runConfig.rpcUrl, getCoston2AccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        const context: IAssetBotContext = await createAssetContext(botConfig, botConfig.chains[0]);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(botConfig.chains[0].chainInfo.chainId);
    });

    it("Should not create asset context - contractsJsonFile or addressUpdater must be defined", async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        runConfig.addressUpdater = undefined;
        runConfig.contractsJsonFile = undefined;
        accounts = await initWeb3(runConfig.rpcUrl, getCoston2AccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        await expect(createAssetContext(botConfig, botConfig.chains[0])).to.eventually.be.rejected;
    });

    it("Should not create asset context - assetManager or fAssetSymbol required in chain config", async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        runConfig.addressUpdater = undefined;
        runConfig.contractsJsonFile = undefined;
        accounts = await initWeb3(runConfig.rpcUrl, getCoston2AccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        botConfig.chains[0].assetManager = undefined;
        botConfig.chains[0].fAssetSymbol = undefined;
        await expect(createAssetContext(botConfig, botConfig.chains[0])).to.eventually.be.rejected;
    });

    it("Should not create asset context - FAsset symbol not found", async () => {
        runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        runConfig.addressUpdater = undefined;
        runConfig.contractsJsonFile = undefined;
        accounts = await initWeb3(runConfig.rpcUrl, getCoston2AccountsFromEnv(), null);
        ownerAddress = accounts[0];
        botConfig = await createBotConfig(runConfig, OWNER_ADDRESS);
        botConfig.chains[0].assetManager = undefined;
        botConfig.chains[0].fAssetSymbol = "RandomAsset";
        await expect(createAssetContext(botConfig, botConfig.chains[0])).to.eventually.be.rejected;
    });

});