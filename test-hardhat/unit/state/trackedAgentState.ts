import { expect } from "chai";
import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { TrackedAgentState } from "../../../src/state/TrackedAgentState";
import { TrackedState } from "../../../src/state/TrackedState";
import { toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { createTestAgentBot, mintClass1ToOwner } from "../../test-utils/helpers";
import { AgentStatus, CollateralClass } from "../../../src/fasset/AssetManagerTypes";

const agentCreated = {
    owner: '0x92561F28Ec438Ee9831D00D1D59fbDC981b762b2',
    agentVault: '0xEA6aBEf9ea06253364Bb6cf53065dAFD2ca122FC',
    collateralPool: '0xCd17f01812099F7B76098f9bdCb93eC1DfDF24de',
    underlyingAddress: 'UNDERLYING_ACCOUNT_26086',
    class1CollateralToken: '0x52d3b94181f8654db2530b0fEe1B19173f519C52',
    feeBIPS: toBN(1000),
    poolFeeShareBIPS: toBN(4000),
    mintingClass1CollateralRatioBIPS: toBN(16800),
    mintingPoolCollateralRatioBIPS: toBN(26400),
    buyFAssetByAgentFactorBIPS: toBN(9000),
    poolExitCollateralRatioBIPS: toBN(28600),
    poolTopupCollateralRatioBIPS: toBN(24200),
    poolTopupTokenPriceFactorBIPS: toBN(8000)
}

describe("Tracked agent state tests", async () => {
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
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        trackedStateContext = getTestAssetTrackedStateContext(context);
    });

    beforeEach(async () => {
        agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentClass1Token = await agentBot.agent.getClass1CollateralToken();
        await mintClass1ToOwner(amount, agentClass1Token.token, ownerAddress);
        await agentBot.agent.depositClass1Collateral(amount);
        const lastBlock = await web3.eth.getBlockNumber();
        trackedState = new TrackedState(trackedStateContext, lastBlock);
        await trackedState.initialize();
        trackedAgentState = new TrackedAgentState(trackedState, agentCreated);
        trackedAgentState.initialize(await agentBot.agent.getAgentInfo());
    });

    it("Should return agent status", async () => {
        trackedAgentState.status = AgentStatus.DESTROYING;
        const status = trackedAgentState.possibleLiquidationTransition(toBN(0));
        expect(status.toString()).to.eq(trackedAgentState.status.toString());
    });

    it("Should receive collateral balance", async () => {
        const class1 = trackedAgentState.parent.collaterals.get(CollateralClass.CLASS1, trackedAgentState.agentSettings.class1CollateralToken);
        const pool = trackedAgentState.parent.collaterals.get(CollateralClass.POOL, trackedAgentState.parent.poolWNatCollateral.token);
        expect(trackedAgentState.collateralBalance(class1).eq(amount)).to.be.true;
        expect(trackedAgentState.collateralBalance(pool).eqn(0)).to.be.true;
    });

});