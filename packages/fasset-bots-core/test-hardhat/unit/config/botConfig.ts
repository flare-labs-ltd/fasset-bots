import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { readFileSync } from "fs";
import { loadConfigFile } from "../../../src/config/config-file-loader";
import { loadAgentSettings } from "../../../src/config/AgentVaultInitSettings";
import { createAgentVaultInitSettings } from "../../../src/config/AgentVaultInitSettings";
import { AgentSettingsConfig } from "../../../src/config/config-files/AgentSettingsConfig";
import { toBIPS } from "../../../src/utils";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { DEFAULT_AGENT_SETTINGS_PATH_HARDHAT } from "../../test-utils/helpers";
use(chaiAsPromised);

describe("Config unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });

    async function initialize() {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        return { context };
    }

    beforeEach(async () => {
        ({ context } = await loadFixtureCopyVars(initialize));
    });

    it("Should create tracked state config", async () => {
        const defaultAgentSettings = await createAgentVaultInitSettings(context, loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT));
        const agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT).toString()) as AgentSettingsConfig;
        expect(defaultAgentSettings.feeBIPS.toString()).to.eq(toBIPS(agentSettingsConfig.fee).toString());
        expect(defaultAgentSettings.poolFeeShareBIPS.toString()).to.eq(toBIPS(agentSettingsConfig.poolFeeShare).toString());
    });

    it("Should not create tracked state config - invalid vault collateral", async () => {
        const initialAgentPath = "./test-hardhat/test-utils/run-config-tests/invalid-agent-settings-config-hardhat.json";
        const initialAgentSettings = JSON.parse(readFileSync(initialAgentPath).toString()) as AgentSettingsConfig;
        await expect(createAgentVaultInitSettings(context, initialAgentSettings))
            .to.eventually.be.rejectedWith(`Invalid vault collateral token ${initialAgentSettings.vaultCollateralFtsoSymbol}`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not initialize", async () => {
        const runConfigFile1 = "./test-hardhat/test-utils/run-config-tests/run-config-missing-contracts-and-addressUpdater.json";
        const fn = () => {
            return loadConfigFile(runConfigFile1);
        };
        expect(fn).to.throw("At least one of contractsJsonFile or assetManagerController is required config");
    });
});
