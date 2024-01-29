/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { DEFAULT_AGENT_SETTINGS_PATH_HARDHAT, DEFAULT_POOL_TOKEN_SUFFIX } from "../../test-utils/helpers";
import { createAgentBotDefaultSettings, loadAgentSettings, loadConfigFile } from "../../../src/config/BotConfig";
import { AgentSettingsConfig } from "../../../src/config/config-files";
import { web3 } from "../../../src/utils/web3";
import { readFileSync } from "fs";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { toBIPS } from "../../../src/utils";
use(chaiAsPromised);

describe("Config unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    it("Should create tracked state config", async () => {
        const defaultAgentSettings = await createAgentBotDefaultSettings(context, loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT));
        const agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT).toString()) as AgentSettingsConfig;
        expect(defaultAgentSettings.feeBIPS.toString()).to.eq(toBIPS(agentSettingsConfig.fee).toString());
        expect(defaultAgentSettings.poolFeeShareBIPS.toString()).to.eq(toBIPS(agentSettingsConfig.poolFeeShare).toString());
    });

    it("Should not create tracked state config - invalid vault collateral", async () => {
        const initialAgentPath = "./test-hardhat/test-utils/run-config-tests/invalid-agent-settings-config-hardhat.json";
        const initialAgentSettings = JSON.parse(readFileSync(initialAgentPath).toString()) as AgentSettingsConfig;
        await expect(createAgentBotDefaultSettings(context, initialAgentSettings))
            .to.eventually.be.rejectedWith(`Invalid vault collateral token ${initialAgentSettings.vaultCollateralFtsoSymbol}`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not initialize", async () => {
        const runConfigFile1 = "./test-hardhat/test-utils/run-config-tests/run-config-missing-contracts-and-addressUpdater.json";
        const fn = () => {
            return loadConfigFile(runConfigFile1);
        };
        expect(fn).to.throw("Missing either contractsJsonFile or addressUpdater in config");
    });
});
