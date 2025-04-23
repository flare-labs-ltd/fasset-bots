import { expect } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { AgentStatus, CollateralClass } from "../../../src/fasset/AssetManagerTypes";
import { InitialAgentData, TrackedAgentState } from "../../../src/state/TrackedAgentState";
import { TrackedState } from "../../../src/state/TrackedState";
import { toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../../test/test-utils/create-test-orm";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createTestAgentBot, mintVaultCollateralToOwner } from "../../test-utils/helpers";

const agentCreated: InitialAgentData = {
    owner: "0x92561F28Ec438Ee9831D00D1D59fbDC981b762b2",
    agentVault: "0xEA6aBEf9ea06253364Bb6cf53065dAFD2ca122FC",
    creationData: {
        collateralPool: "0xCd17f01812099F7B76098f9bdCb93eC1DfDF24de",
        collateralPoolToken: "0xfd1cC06cf865b9635Be915931Ca35e5Fa7561Dcf",
        underlyingAddress: "UNDERLYING_ACCOUNT_26086",
        vaultCollateralToken: "0x52d3b94181f8654db2530b0fEe1B19173f519C52",
        poolWNatToken: "0xF81c8917353E76E180dDf97aD328c0C3C6Fe38F7",
        feeBIPS: toBN(1000),
        poolFeeShareBIPS: toBN(4000),
        mintingVaultCollateralRatioBIPS: toBN(16800),
        mintingPoolCollateralRatioBIPS: toBN(26400),
        buyFAssetByAgentFactorBIPS: toBN(9000),
        poolExitCollateralRatioBIPS: toBN(28600),
        poolTopupCollateralRatioBIPS: toBN(24200),
        poolTopupTokenPriceFactorBIPS: toBN(8000),
        handshakeType: toBN(0),
    }
};

describe("Tracked agent state tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
    let orm: ORM;
    let ownerAddress: string;
    let agentBot: AgentBot;
    let trackedAgentState: TrackedAgentState;
    let trackedState: TrackedState;
    const amount = toBN(10000);

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        trackedStateContext = getTestAssetTrackedStateContext(context);
        // create agent bot
        agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentVaultCollateralToken = await agentBot.agent.getVaultCollateral();
        await mintVaultCollateralToOwner(amount, agentVaultCollateralToken.token, ownerAddress);
        await agentBot.agent.depositVaultCollateral(amount);
        trackedState = new TrackedState(trackedStateContext);
        await trackedState.initialize();
        trackedAgentState = new TrackedAgentState(trackedState, agentCreated);
        const { info: agentInfo } = await trackedState.getExtendedAgentInfo(agentBot.agent.vaultAddress);
        trackedAgentState.initialize(agentInfo);
        return { orm, context, trackedStateContext, agentBot, trackedState, trackedAgentState };
    }

    beforeEach(async () => {
        ({ orm, context, trackedStateContext, agentBot, trackedState, trackedAgentState } = await loadFixtureCopyVars(initialize));
    });

    it("Should return agent status", async () => {
        trackedAgentState.status = AgentStatus.DESTROYING;
        const status = trackedAgentState.possibleLiquidationTransition(toBN(0));
        expect(status.toString()).to.eq(trackedAgentState.status.toString());
    });

    it("Should receive collateral balance", async () => {
        const vaultC = trackedAgentState.parent.collaterals.get(CollateralClass.VAULT, trackedAgentState.agentSettings.vaultCollateralToken);
        const poolC = trackedAgentState.parent.collaterals.get(CollateralClass.POOL, trackedAgentState.parent.poolWNatCollateral.token);
        expect(trackedAgentState.collateralBalance(vaultC).eq(amount)).to.be.true;
        expect(trackedAgentState.collateralBalance(poolC).eqn(0)).to.be.true;
    });
});
