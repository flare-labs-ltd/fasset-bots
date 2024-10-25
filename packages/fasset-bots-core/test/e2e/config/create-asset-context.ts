import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { readFileSync } from "fs";
import { AgentBotConfig, KeeperBotConfig, Secrets } from "../../../src/config";
import { createBotConfig } from "../../../src/config/BotConfig";
import { updateConfigFilePaths } from "../../../src/config/config-file-loader";
import { BotConfigFile } from "../../../src/config/config-files/BotConfigFile";
import { createAgentBotContext, createChallengerContext, createLiquidatorContext, createTimekeeperContext } from "../../../src/config/create-asset-context";
import { IAssetAgentContext } from "../../../src/fasset-bots/IAssetBotContext";
import { firstValue } from "../../../src/utils";
import { initWeb3 } from "../../../src/utils/web3";
import { COSTON_RPC, COSTON_RUN_CONFIG_ADDRESS_UPDATER, COSTON_RUN_CONFIG_CONTRACTS, COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER, COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { getNativeAccounts } from "../../test-utils/test-helpers";
use(chaiAsPromised);

function simpleLoadConfigFile(fpath: string) {
    const config = JSON.parse(readFileSync(fpath).toString()) as BotConfigFile;
    updateConfigFilePaths(fpath, config);
    return config;
}

describe("Create asset context tests", () => {
    let secrets: Secrets;
    let runConfig: BotConfigFile;
    let botConfig: AgentBotConfig;
    let actorRunConfig: BotConfigFile;
    let actorConfig: KeeperBotConfig;
    let accounts: string[];

    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
        accounts = await initWeb3(COSTON_RPC, getNativeAccounts(secrets), null);
    });

    it("Should create asset context from contracts", async () => {
        runConfig = simpleLoadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        botConfig = await createBotConfig("agent", secrets, runConfig, accounts[0]);
        const context: IAssetAgentContext = await createAgentBotContext(botConfig, firstValue(botConfig.fAssets)!);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(firstValue(botConfig.fAssets)!.chainInfo.chainId);
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create asset context given asset manager controller", async () => {
        runConfig = JSON.parse(readFileSync(COSTON_RUN_CONFIG_ADDRESS_UPDATER).toString()) as BotConfigFile;
        botConfig = await createBotConfig("agent", secrets, runConfig, accounts[0]);
        const context: IAssetAgentContext = await createAgentBotContext(botConfig, firstValue(botConfig.fAssets)!);
        expect(context).is.not.null;
        expect(context.chainInfo.chainId).to.eq(firstValue(botConfig.fAssets)!.chainInfo.chainId);
    });

    it("Should create simplified asset context from contracts", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS);
        actorConfig = await createBotConfig("keeper", secrets, actorRunConfig, accounts[0]);
        const context = await createChallengerContext(actorConfig, firstValue(actorConfig.fAssets)!);
        expect(context).is.not.null;
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create simplified asset context from address updater", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER);
        actorConfig = await createBotConfig("keeper", secrets, actorRunConfig, accounts[0]);
        const context = await createTimekeeperContext(actorConfig, firstValue(actorConfig.fAssets)!);
        expect(context).is.not.null;
    });

    // with addressUpdater and stateConnectorProofVerifierAddress - cannot use only addressUpdater until SCProofVerifier gets verified in explorer
    it("Should create simplified asset context from address updater and not define attestationProvider", async () => {
        actorRunConfig = simpleLoadConfigFile(COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER);
        actorRunConfig.attestationProviderUrls = undefined;
        Object.values(actorRunConfig.fAssets)[0].indexerUrl = undefined;
        const commonConfig = await createBotConfig("common", secrets, actorRunConfig, accounts[0]);
        const context = await createLiquidatorContext(commonConfig, firstValue(actorConfig.fAssets)!);
        expect(context).is.not.null;
    });
});
