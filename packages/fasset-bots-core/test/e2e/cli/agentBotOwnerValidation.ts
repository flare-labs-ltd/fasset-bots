import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { Secrets, createAgentBotContext, createBotConfig, loadConfigFile } from "../../../src/config";
import { initWeb3 } from "../../../src/utils/web3";
import { COSTON_RPC, COSTON_RUN_CONFIG_CONTRACTS, TEST_FASSET_BOT_CONFIG, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { getNativeAccounts } from "../../test-utils/test-helpers";
import { AgentBotOwnerValidation, printingReporter } from "../../../src/commands/AgentBotOwnerValidation";
import { IAssetAgentContext } from "../../../src/fasset-bots/IAssetBotContext";
import { requireNotNull } from "../../../src/utils";
use(spies);

const fassetBotConfig = TEST_FASSET_BOT_CONFIG;
const fAssetSymbol = "FtestXRP";

describe("AgentBotOwnerValidation cli commands unit tests", () => {
    let secrets: Secrets;
    let accounts: string[];
    let ownerAddress: string;
    let context: IAssetAgentContext;

    async function createOwnerValidation() {
        return await AgentBotOwnerValidation.create(TEST_SECRETS, fassetBotConfig, printingReporter);
    }

    before(async () => {
        secrets = Secrets.load(TEST_SECRETS);
        accounts = await initWeb3(COSTON_RPC, getNativeAccounts(secrets), null);
        ownerAddress = accounts[0];
        secrets = Secrets.load(TEST_SECRETS);
        const runConfig = loadConfigFile(COSTON_RUN_CONFIG_CONTRACTS);
        const botConfig = await createBotConfig("agent", secrets, runConfig, ownerAddress);
        const chainConfigAgent = requireNotNull(botConfig.fAssets.get(fAssetSymbol));
        context = await createAgentBotContext(botConfig, chainConfigAgent!);
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should initialize AgentBotOwnerValidation ", async () => {
        const botOwnerValidation = await AgentBotOwnerValidation.create(TEST_SECRETS, fassetBotConfig);
        expect(botOwnerValidation.agentOwnerRegistry).to.not.be.null;
        expect(botOwnerValidation.secrets).to.not.be.null;
        expect(botOwnerValidation.configFile).to.not.be.null;
        expect(botOwnerValidation.fassets).to.not.be.null;
    });

    it("Should initialize AgentBotOwnerValidation from context", async () => {
        const botOwnerValidationContext = await AgentBotOwnerValidation.fromContext(context, TEST_SECRETS, fassetBotConfig);
        expect(botOwnerValidationContext.agentOwnerRegistry).to.not.be.null;
        expect(botOwnerValidationContext.secrets).to.not.be.null;
        expect(botOwnerValidationContext.configFile).to.not.be.null;
        expect(botOwnerValidationContext.fassets).to.not.be.null;
    });

    it("Should validateOwnerNativeAddresses", async () => {
        const spyConsole = spy.on(console, "log");
        const botOwnerVAlidation = await createOwnerValidation();
        await botOwnerVAlidation.validateOwnerNativeAddresses();
        expect(spyConsole).to.be.called.exactly(9);
    });

    it("Should validateForFAsset", async () => {
        const spyConsole = spy.on(console, "log");
        const botOwnerVAlidation = await createOwnerValidation();
        await botOwnerVAlidation.validateForFAsset(fAssetSymbol);
        expect(spyConsole).to.be.called.exactly(3);
    });

    it("Should validate FAssets", async () => {
        const spyConsole = spy.on(console, "log");
        const botOwnerVAlidation = await createOwnerValidation();
        await botOwnerVAlidation.validate([fAssetSymbol]);
        expect(spyConsole).to.be.called.exactly(12);
    });

    it("Should validate address", async () => {
        const validate = AgentBotOwnerValidation.validateAddress(null, "");
        expect(validate).to.be.undefined;
    });

    it("Should createWalletTokenBalance", async () => {
        const botOwnerVAlidation = await createOwnerValidation();
        const asset = await botOwnerVAlidation.fassets.get(fAssetSymbol)?.assetSymbol();
        const wallet = await botOwnerVAlidation.createWalletTokenBalance(fAssetSymbol);
        expect(wallet.symbol).to.equal(asset);
    });
});
