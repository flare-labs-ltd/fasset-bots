/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { disableMccTraceManager } from "../../test-utils/helpers";
import { AgentSettingsConfig, createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { web3 } from "../../../src/utils/web3";
import { readFileSync } from "fs";
import { requireEnv } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);

const DEFAULT_AGENT_SETTINGS_PATH_HARDHAT: string = requireEnv('DEFAULT_AGENT_SETTINGS_PATH_HARDHAT');

describe("Config unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
    });

    beforeEach(async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
    });

    it("Should create tracked state config", async () => {
        const defaultAgentSettings = await createAgentBotDefaultSettings(context, JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT).toString()));
        const agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT).toString()) as AgentSettingsConfig;
        expect(defaultAgentSettings.feeBIPS.toString()).to.eq(agentSettingsConfig.feeBIPS.toString());
        expect(defaultAgentSettings.poolFeeShareBIPS.toString()).to.eq(agentSettingsConfig.poolFeeShareBIPS.toString());
    });

    it("Should not create tracked state config - invalid class1", async () => {
        const initialAgentSettings = {
            class1FtsoSymbol: "USDCXYZ",
            feeBIPS: "1000",
            poolFeeShareBIPS: "4000",
            mintingClass1CollateralRatioConstant: 1.2,
            mintingPoolCollateralRatioConstant: 1.2,
            poolExitCollateralRatioConstant: 1.3,
            buyFAssetByAgentFactorBIPS: "9000",
            poolTopupCollateralRatioConstant: 1.1,
            poolTopupTokenPriceFactorBIPS: "8000"
        } as AgentSettingsConfig;
        await expect(createAgentBotDefaultSettings(context, initialAgentSettings)).to.eventually.be.rejectedWith(`Invalid class1 collateral token ${initialAgentSettings.class1FtsoSymbol}`).and.be.an.instanceOf(Error);
    });

});