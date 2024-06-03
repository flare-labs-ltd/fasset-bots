import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { readFileSync } from "fs";
import { loadConfigFile, updateConfigFilePaths, validateAgentConfigFile, validateConfigFile } from "../../../src/config/config-file-loader";
import { BotConfigFile } from "../../../src/config/config-files/BotConfigFile";
import { COSTON_CONFIG_EXTENDS_1, COSTON_CONFIG_EXTENDS_2, COSTON_CONFIG_INVALID, COSTON_CONFIG_LOOP_1, COSTON_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import { resolveInFassetBotsCore } from "../../../src/utils";
use(chaiAsPromised);

function simpleLoadConfigFile(fpath: string) {
    const config = JSON.parse(readFileSync(fpath).toString()) as BotConfigFile;
    updateConfigFilePaths(fpath, config);
    return config;
}

describe("config file loader tests", () => {
    it("Should load config file", async () => {
        const configFile = loadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        expect(configFile.contractsJsonFile).eq(resolveInFassetBotsCore("fasset-deployment/coston.json"));
        expect(configFile.assetManagerController).eq(undefined);
        expect(configFile.fAssets.FTestXRP.tokenSymbol).eq("testXRP");
        expect(configFile.ormOptions?.dbName).matches(/fasset-bots-coston\.[0-9a-fA-F]{8}\.db/)
    });

    it("Should load config file with extends", async () => {
        const configFile = loadConfigFile(COSTON_CONFIG_EXTENDS_1);
        expect(configFile.contractsJsonFile).eq(resolveInFassetBotsCore("fasset-deployment/coston.json"));
        expect(configFile.assetManagerController).eq("0x82Ddf05b6e530260866E619a59d41D358412C466");
        expect(configFile.fAssets.FTestXRP.tokenSymbol).eq("testXRP");
    });

    it("Should load config file with extends - 2 level", async () => {
        const configFile = loadConfigFile(COSTON_CONFIG_EXTENDS_2);
        expect(configFile.contractsJsonFile).eq(resolveInFassetBotsCore("fasset-deployment/coston.json"));
        expect(configFile.assetManagerController).eq("0x82Ddf05b6e530260866E619a59d41D358412C466");
        expect(configFile.fAssets.FTestXRP.tokenSymbol).eq("testXRP");
        expect(configFile.fAssets.FTestXRP.walletUrl).eq("https://my.wallet.xyz");
        expect(configFile.fAssets.Fnothing).eq(undefined);  // cannot override unknown fasset
        expect(configFile.ormOptions?.dbName).eq("fasset-bots-coston.82Ddf05b.db")
    });

    it("Should not load config file - schema validation", async () => {
        expect(() => loadConfigFile(COSTON_CONFIG_INVALID))
            .to.throw(/Invalid bot config JSON format: *must have required property/);
    });

    it("Should not load config file - extends loop", async () => {
        expect(() => loadConfigFile(COSTON_CONFIG_LOOP_1))
            .to.throw(/Circular config file dependency/);
    });

    it("Should not validate config - contractsJsonFile or addressUpdater must be defined", async () => {
        const runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runConfig.contractsJsonFile = undefined;
        runConfig.assetManagerController = undefined;
        expect(() => validateConfigFile(runConfig))
            .to.throw(`At least one of contractsJsonFile or assetManagerController must be defined`);
    });

    it("Should not validate config - attestation provider must be defined", async () => {
        const runConfig: BotConfigFile = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        runConfig.attestationProviderUrls = undefined;
        expect(() => validateAgentConfigFile(runConfig))
            .to.throw(`At least one attestation provider url is required`);
        runConfig.attestationProviderUrls = [];
        expect(() => validateAgentConfigFile(runConfig))
            .to.throw(`At least one attestation provider url is required`);
    });

    it("Should not validate config - walletUrl must be defined", async () => {
        const runConfig: BotConfigFile = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        const [symbol, fasset] = Object.entries(runConfig.fAssets)[0];
        fasset.walletUrl = undefined;
        expect(() => validateAgentConfigFile(runConfig))
            .to.throw(`Missing walletUrl in FAsset type ${symbol}`);
    });
});
