import { FilterQuery } from "@mikro-orm/core";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { assert, expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentBotSettings } from "../../../src/config";
import { ORM } from "../../../src/config/orm";
import { AgentEntity, AgentMinting, AgentRedemption, AgentUnderlyingPayment, AgentUpdateSetting } from "../../../src/entities/agent";
import { AgentMintingState, AgentRedemptionState, AgentSettingName, AgentUnderlyingPaymentState, AgentUnderlyingPaymentType, AgentUpdateSettingState } from "../../../src/entities/common";
import { AgentStatus } from "../../../src/fasset/AssetManagerTypes";
import { PaymentReference } from "../../../src/fasset/PaymentReference";
import { MockChain } from "../../../src/mock/MockChain";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";
import { requiredEventArgs } from "../../../src/utils/events/truffle";
import { attestationWindowSeconds } from "../../../src/utils/fasset-helpers";
import { MINUTES, ZERO_ADDRESS, checkedCast, maxBN, toBN } from "../../../src/utils/helpers";
import { artifacts, web3 } from "../../../src/utils/web3";
import { latestBlockTimestampBN } from "../../../src/utils/web3helpers";
import { testAgentBotSettings, testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../../test/test-utils/create-test-orm";
import { fundUnderlying } from "../../../test/test-utils/test-helpers";
import { testNotifierTransports } from "../../../test/test-utils/testNotifierTransports";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { getLotSize } from "../../test-utils/fuzzing-utils";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createTestAgentBot, createTestAgentBotAndMakeAvailable, mintVaultCollateralToOwner, updateAgentBotUnderlyingBlockProof } from "../../test-utils/helpers";
use(spies);
use(chaiAsPromised);

const randomUnderlyingAddress = "RANDOM_UNDERLYING";

describe("Agent bot unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let agentBotSettings: AgentBotSettings;
    let orm: ORM;
    let ownerAddress: string;
    let ownerUnderlyingAddress: string;
    let chain: MockChain;

    before(async () => {
        accounts = await web3.eth.getAccounts();
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        agentBotSettings = testAgentBotSettings.xrp;
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        // accounts
        ownerAddress = accounts[3];
        await context.agentOwnerRegistry.setWorkAddress(accounts[4], { from: ownerAddress });
        ownerUnderlyingAddress = "underlying_owner_1";
        return { orm, context, chain, ownerAddress, ownerUnderlyingAddress };
    }

    beforeEach(async () => {
        ({ orm, context, chain, ownerAddress, ownerUnderlyingAddress } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create agent bot", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        expect(agentBot.agent.owner.managementAddress).to.eq(ownerAddress);
        expect(agentBot.agent.underlyingAddress).to.not.be.null;
    });

    it("Should fail creating agent bot if work address isn't set", async () => {
        const context2 = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        await expectRevert(createTestAgentBot(context2, orm, ownerAddress, undefined, false), `Management address ${ownerAddress} has no registered work address.`);
    });

    it("Should read agent bot from entity", async () => {
        const agentBotBefore = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBotBefore.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentBotSettings, agentEnt, ownerUnderlyingAddress, testNotifierTransports);
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.owner.managementAddress).to.eq(ownerAddress);
    });

    it("Should fail reading agent bot from entity if work address isn't set", async () => {
        const agentBotBefore = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        await context.agentOwnerRegistry.setWorkAddress(ZERO_ADDRESS, { from: ownerAddress });
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBotBefore.agent.vaultAddress } as FilterQuery<AgentEntity>);
        await expectRevert(AgentBot.fromEntity(context, agentBotSettings, agentEnt, ownerUnderlyingAddress, testNotifierTransports), `Management address ${ownerAddress} has no registered work address.`);
    });

    it("Should run readUnhandledEvents", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const [events, lastBlock] = await agentBot.eventReader.readNewEvents(orm.em, 10);
        expect(events.length).to.eq(0);
    });
    
    it("Should report outdated agents", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const latest = await time.latestBlock();
        const lastReport = agentBot.transientStorage.lastOutdatedEventReported;
        await agentBot.eventReader.reportOutdatedAgent(parseInt(latest.toString()) - 10, parseInt(latest.toString()), 3, 3)
        const newReport = agentBot.transientStorage.lastOutdatedEventReported;
        expect(newReport).to.be.gt(lastReport);
    });

    it("Should top up collateral", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyTop = spy.on(agentBot.collateralManagement, "requiredTopUp");
        await agentBot.collateralManagement.checkAgentForCollateralRatiosAndTopUp();
        expect(spyTop).to.have.been.called.twice;
    });

    it("Should top up underlying", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyBalance0 = spy.on(agentBot.underlyingManagement, "createAgentUnderlyingPayment");
        const spyBalance1 = spy.on(agentBot.notifier, "sendLowBalanceOnUnderlyingOwnersAddress");
        const spyBalance2 = spy.on(agentBot.underlyingManagement.notifier, "sendConfirmWithdrawUnderlying");
        const balance = await context.blockchainIndexer.chain.getBalance(ownerUnderlyingAddress);
        await agentBot.underlyingManagement.underlyingTopUp(orm.em, toBN(balance).sub(context.chainInfo.minimumAccountBalance));
        chain.mine(chain.finalizationBlocks + 1);
        expect(spyBalance0).to.have.been.called.once;
        expect(spyBalance1).to.have.been.called.once;
        const topUpPayment0 = await orm.em.findOneOrFail(AgentUnderlyingPayment, { type: AgentUnderlyingPaymentType.TOP_UP }  as FilterQuery<AgentUnderlyingPayment>, { orderBy: { id: ('DESC') } });
        expect(topUpPayment0.state).to.equal(AgentUnderlyingPaymentState.PAID);
        // run agent's steps until underlying payment process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if underlying payment is done
            orm.em.clear();
            const underlyingPayment = await orm.em.findOneOrFail(AgentUnderlyingPayment, { txHash: topUpPayment0.txHash }  as FilterQuery<AgentUnderlyingPayment> );
            console.log(`Agent step ${i}, state = ${underlyingPayment.state}`);
            if (underlyingPayment.state === AgentUnderlyingPaymentState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        expect(spyBalance2).to.have.been.called.once;
    });

    it("Should prove EOA address - no funds", async () => {
        const spyEOA = spy.on(AgentBot, "proveEOAaddress");
        const contextEOAProof = await createTestAssetContext(accounts[0], testChainInfo.xrp, { requireEOAAddressProof: true });
        await contextEOAProof.agentOwnerRegistry.setWorkAddress(accounts[4], { from: ownerAddress });
        await expect(createTestAgentBot(contextEOAProof, orm, ownerAddress)).to.eventually.be.rejectedWith(/^Not enough funds on underlying address/).and.be.an.instanceOf(Error);
        expect(spyEOA).to.have.been.called.once;
    });

    // it.only("Should prove EOA address - funded", async () => {
    //     const spyEOA = spy.on(AgentBot, "proveEOAaddress");
    //     // await fundUnderlying(context, ownerUnderlyingAddress, toBN(100000000))
    //     const contextEOAProof = await createTestAssetContext(accounts[0], testChainInfo.xrp, { requireEOAAddressProof: true });
    //     await contextEOAProof.agentOwnerRegistry.setWorkAddress(accounts[4], { from: ownerAddress });
    //     contextEOAProof.chainInfo.minimumAccountBalance = toBN(0);
    //     await createTestAgentBot(contextEOAProof, orm, ownerAddress, ownerUnderlyingAddress)
    //     // await expect(createTestAgentBot(contextEOAProof, orm, ownerAddress, ownerUnderlyingAddress)).to.eventually.be.rejectedWith(/^Not enough funds on underlying address/).and.be.an.instanceOf(Error);
    //     expect(spyEOA).to.have.been.called.once;
    // });

    it("Should not do next redemption step due to invalid redemption state", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyLog = spy.on(console, "error");
        // create redemption with invalid state
        const rd = new AgentRedemption();
        rd.state = "invalid" as AgentRedemptionState;
        rd.agentAddress = "";
        rd.requestId = toBN("");
        rd.paymentAddress = ""
        rd.valueUBA = toBN(0);
        rd.feeUBA = toBN(0);
        rd.paymentReference = "";
        rd.lastUnderlyingBlock = toBN(0);
        rd.lastUnderlyingTimestamp = toBN(0);
        await orm.em.persistAndFlush(rd);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.redemption.handleOpenRedemption(orm.em, rd.state, rd);
        expect(spyLog).to.have.been.called.once;
    });

    it("Should not do next minting step due to invalid minting state", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyLog = spy.on(console, "error");
        // create minting with invalid state
        const mt = new AgentMinting();
        mt.state = "invalid" as AgentMintingState;
        mt.agentAddress = "";
        mt.requestId = toBN("");
        mt.agentUnderlyingAddress = ""
        mt.valueUBA = toBN(0);
        mt.feeUBA = toBN(0);
        mt.firstUnderlyingBlock = toBN(0);
        mt.paymentReference = "";
        mt.lastUnderlyingBlock = toBN(0);
        mt.lastUnderlyingTimestamp = toBN(0);
        await orm.em.persistAndFlush(mt);
        await agentBot.minting.nextMintingStep(orm.em, mt.id);
        expect(spyLog).to.have.been.called.once;
    });

    it("Should not do next minting step due to minting not found in db", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyLog = spy.on(console, "error");
        await agentBot.minting.nextMintingStep(orm.em, 1000);
        expect(spyLog).to.have.been.called.once;
    });

    it("Should return open redemptions", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        // create redemptions
        const rd1 = new AgentRedemption();
        rd1.state = AgentRedemptionState.STARTED;
        rd1.agentAddress = agentBot.agent.vaultAddress;
        rd1.requestId = toBN("000");
        rd1.paymentAddress = ""
        rd1.valueUBA = toBN(0);
        rd1.feeUBA = toBN(0);
        rd1.paymentReference = "";
        rd1.lastUnderlyingBlock = toBN(0);
        rd1.lastUnderlyingTimestamp = toBN(0);

        const rd2 = new AgentRedemption();
        rd2.state = AgentRedemptionState.DONE;
        rd2.agentAddress = agentBot.agent.vaultAddress;
        rd2.requestId = toBN("001");
        rd2.paymentAddress = ""
        rd2.valueUBA = toBN(0);
        rd2.feeUBA = toBN(0);
        rd2.paymentReference = "";
        rd2.lastUnderlyingBlock = toBN(0);
        rd2.lastUnderlyingTimestamp = toBN(0);

        await orm.em.persistAndFlush([rd1, rd2]);
        const started = await agentBot.redemption.redemptionsInState(orm.em, AgentRedemptionState.STARTED, 100);
        const done = await agentBot.redemption.redemptionsInState(orm.em, AgentRedemptionState.DONE, 100);
        expect(started.length).to.eq(1);
        expect(done.length).to.eq(1);
    });

    it("Should not receive proof 1 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainReferencedPaymentNonexistenceProof");
        // create minting
        const mt = new AgentMinting();
        mt.state = AgentMintingState.REQUEST_NON_PAYMENT_PROOF;
        mt.agentAddress = "";
        mt.requestId = toBN(0);
        mt.agentUnderlyingAddress = ""
        mt.valueUBA = toBN(0);
        mt.feeUBA = toBN(0);
        mt.firstUnderlyingBlock = toBN(0);
        mt.paymentReference = "";
        mt.lastUnderlyingBlock = toBN(0);
        mt.lastUnderlyingTimestamp = toBN(0);
        mt.proofRequestRound = 1;
        mt.proofRequestData = "";
        await agentBot.minting.checkNonPayment(orm.em, mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 2 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainPaymentProof");
        // create minting
        const mt = new AgentMinting();
        mt.state = AgentMintingState.REQUEST_PAYMENT_PROOF;
        mt.agentAddress = "";
        mt.requestId = toBN(0);
        mt.agentUnderlyingAddress = ""
        mt.valueUBA = toBN(0);
        mt.feeUBA = toBN(0);
        mt.firstUnderlyingBlock = toBN(0);
        mt.paymentReference = "";
        mt.lastUnderlyingBlock = toBN(0);
        mt.lastUnderlyingTimestamp = toBN(0);
        mt.proofRequestRound = 1;
        mt.proofRequestData = "";
        await agentBot.minting.checkPaymentAndExecuteMinting(orm.em, mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 3 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainPaymentProof");
        // create redemption
        const rd = new AgentRedemption();
        rd.state = AgentRedemptionState.REQUESTED_PROOF;
        rd.agentAddress = agentBot.agent.vaultAddress;
        rd.requestId = toBN("003");
        rd.paymentAddress = ""
        rd.valueUBA = toBN(0);
        rd.feeUBA = toBN(0);
        rd.paymentReference = "";
        rd.lastUnderlyingBlock = toBN(0);
        rd.lastUnderlyingTimestamp = toBN(0);
        rd.proofRequestRound = 1;
        rd.proofRequestData = "";
        await agentBot.redemption.checkConfirmPayment(orm.em, rd);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 3 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainPaymentProof");
        // create redemption
        const rd = new AgentRedemption();
        rd.state = AgentRedemptionState.REQUESTED_PROOF;
        rd.agentAddress = agentBot.agent.vaultAddress;
        rd.requestId = toBN("003");
        rd.paymentAddress = ""
        rd.valueUBA = toBN(0);
        rd.feeUBA = toBN(0);
        rd.paymentReference = "";
        rd.lastUnderlyingBlock = toBN(0);
        rd.lastUnderlyingTimestamp = toBN(0);
        rd.proofRequestRound = 1;
        rd.proofRequestData = "";
        await agentBot.redemption.checkConfirmPayment(orm.em, rd);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 4 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainPaymentProof");
        // create underlying payment
        const up = new AgentUnderlyingPayment();
        up.state = AgentUnderlyingPaymentState.REQUESTED_PROOF;
        up.agentAddress = agentBot.agent.vaultAddress;
        up.type = AgentUnderlyingPaymentType.TOP_UP;
        up.txHash = "hash";
        up.proofRequestRound = 1;
        up.proofRequestData = "data";
        await agentBot.underlyingManagement.checkConfirmPayment(orm.em, up);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 1 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context.assetManager));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.notifier, "sendMintingDefaultFailure");
        // create minting
        const mt = new AgentMinting();
        mt.state = AgentMintingState.REQUEST_NON_PAYMENT_PROOF;
        mt.agentAddress = "";
        mt.requestId = toBN(0);
        mt.agentUnderlyingAddress = ""
        mt.valueUBA = toBN(0);
        mt.feeUBA = toBN(0);
        mt.firstUnderlyingBlock = toBN(0);
        mt.paymentReference = "";
        mt.lastUnderlyingBlock = toBN(0);
        mt.lastUnderlyingTimestamp = toBN(0);
        mt.proofRequestRound = 0;
        mt.proofRequestData = "";
        await orm.em.persistAndFlush(mt);
        await agentBot.minting.checkNonPayment(orm.em, mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 2 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context.assetManager));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.notifier, "sendMintingNoProofObtained");
        // create minting
        const mt = new AgentMinting();
        mt.state = AgentMintingState.REQUEST_PAYMENT_PROOF;
        mt.agentAddress = "";
        mt.requestId = toBN(0);
        mt.agentUnderlyingAddress = ""
        mt.valueUBA = toBN(0);
        mt.feeUBA = toBN(0);
        mt.firstUnderlyingBlock = toBN(0);
        mt.paymentReference = "";
        mt.lastUnderlyingBlock = toBN(0);
        mt.lastUnderlyingTimestamp = toBN(0);
        mt.proofRequestRound = 0;
        mt.proofRequestData = "";
        await orm.em.persistAndFlush(mt);
        await agentBot.minting.checkPaymentAndExecuteMinting(orm.em, mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 3 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context.assetManager));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.notifier, "sendRedemptionNoProofObtained");
        // create redemption
        const rd = new AgentRedemption();
        rd.state = AgentRedemptionState.REQUESTED_PROOF;
        rd.agentAddress = agentBot.agent.vaultAddress;
        rd.requestId = toBN("003");
        rd.paymentAddress = ""
        rd.valueUBA = toBN(0);
        rd.feeUBA = toBN(0);
        rd.paymentReference = "";
        rd.lastUnderlyingBlock = toBN(0);
        rd.lastUnderlyingTimestamp = toBN(0);
        rd.proofRequestRound = 0;
        rd.proofRequestData = "";
        await orm.em.persistAndFlush(rd);
        await agentBot.redemption.checkConfirmPayment(orm.em, rd);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 4 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context.assetManager));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.notifier, "sendDailyTaskNoProofObtained");
        await agentBot.handleDailyTasks(orm.em);
        await time.increase(15 * MINUTES);
        await agentBot.handleDailyTasks(orm.em);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 5 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context.assetManager));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyProof = spy.on(agentBot.notifier, "sendAgentUnderlyingPaymentNoProofObtained");
        // create underlying payment
        const up = new AgentUnderlyingPayment();
        up.state = AgentUnderlyingPaymentState.REQUESTED_PROOF;
        up.agentAddress = agentBot.agent.vaultAddress;
        up.type = AgentUnderlyingPaymentType.TOP_UP;
        up.txHash = "hash";
        up.proofRequestRound = 0;
        up.proofRequestData = "data";
        await orm.em.persistAndFlush(up);
        await agentBot.underlyingManagement.checkConfirmPayment(orm.em, up);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should destruct agent", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const destroyAllowedAt = await agentBot.agent.announceDestroy();
        agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
        const agentInfo = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfo.status).toNumber()).to.eq(AgentStatus.DESTROYING);
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eq(destroyAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(destroyAllowedAt);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
    });

    it("Should withdraw collateral", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const amount = toBN(10000);
        const vaultCollateralTokenAddress = (await agentBot.agent.getVaultCollateral()).token;
        await mintVaultCollateralToOwner(amount, vaultCollateralTokenAddress, agentBot.agent.owner.workAddress);
        await agentBot.agent.depositVaultCollateral(amount);
        const withdrawalAllowedAt = await agentBot.agent.announceVaultCollateralWithdrawal(amount);
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = amount.toString();
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eq(withdrawalAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(withdrawalAllowedAt);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        const agentVaultCollateralBalance = (await agentBot.agent.getAgentInfo()).totalVaultCollateralWei;
        expect(agentVaultCollateralBalance).to.eq("0");
    });

    it("Should update agent settings and catch it if update expires", async () => {
        const invalidUpdateSeconds = toBN((await context.assetManager.getSettings()).agentTimelockedOperationWindowSeconds);
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        // announce updates
        const validAtFeeBIPS = await agentBot.agent.announceAgentSettingUpdate("feeBIPS", 1100);
        const updateSettingFee = new AgentUpdateSetting();
        updateSettingFee.state = AgentUpdateSettingState.WAITING;
        updateSettingFee.agent = await agentBot.fetchAgentEntity(orm.em);
        updateSettingFee.name = AgentSettingName.FEE;
        updateSettingFee.validAt = validAtFeeBIPS;
        await orm.em.persist(updateSettingFee).flush();
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(updateSettingFee.state).to.be.eq(AgentUpdateSettingState.WAITING);
        // allowed
        await time.increaseTo(updateSettingFee.validAt);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(updateSettingFee.state).to.be.eq(AgentUpdateSettingState.DONE);
        // announce and try to update an expired update
        const validAt2 = await agentBot.agent.announceAgentSettingUpdate("poolTopupTokenPriceFactorBIPS", 8100);
        const updateSettingPoolTopup = new AgentUpdateSetting();
        updateSettingPoolTopup.state = AgentUpdateSettingState.WAITING;
        updateSettingPoolTopup.agent = await agentBot.fetchAgentEntity(orm.em);
        updateSettingPoolTopup.name = AgentSettingName.POOL_TOP_UP_TOKEN_PRICE_FACTOR;
        updateSettingPoolTopup.validAt = validAt2;
        await orm.em.persist(updateSettingPoolTopup).flush();
        // cannot update, update expired
        await time.increaseTo(validAt2.add(invalidUpdateSeconds));
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(updateSettingPoolTopup.state).to.be.eq(AgentUpdateSettingState.DONE)
    });

    it("Should update agent settings and catch it if error thrown", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const feeBIPS = toBN((await agentBot.agent.getAgentInfo()).feeBIPS);
        //Announce updates
        const validAtFeeBIPS = await agentBot.agent.announceAgentSettingUpdate("feeBIPS", feeBIPS.muln(10));
        const updateSettingFee = new AgentUpdateSetting();
        updateSettingFee.state = AgentUpdateSettingState.WAITING;
        updateSettingFee.agent = await agentBot.fetchAgentEntity(orm.em);
        updateSettingFee.name = AgentSettingName.FEE;
        updateSettingFee.validAt = validAtFeeBIPS;
        await orm.em.persist(updateSettingFee).flush();
        expect(updateSettingFee.state).to.be.eq(AgentUpdateSettingState.WAITING);
        //allowed
        await time.increaseTo(validAtFeeBIPS);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(updateSettingFee.state).to.be.eq(AgentUpdateSettingState.DONE);
    });

    it("Should exit available", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, undefined, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const validAt = await agentBot.agent.announceExitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = validAt;
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eq(validAt)).to.be.true;
        // allowed
        await time.increaseTo(validAt);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.eqn(0)).to.be.true;
    });

    it("Should run handleTimelockedProcesses and change nothing", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.false;
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(agentEnt.withdrawalAllowedAtAmount).to.eq("");
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.false;
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(agentEnt.withdrawalAllowedAtAmount).to.eq("");
    });

    it("Should exit available before closing vault", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, undefined, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        agentEnt.waitingForDestructionCleanUp = true;
        const validAt = await agentBot.agent.announceExitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = validAt;
        await orm.em.persist(agentEnt).flush();
        await agentBot.handleTimelockedProcesses(orm.em);
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eq(validAt)).to.be.true;
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // allowed
        await time.increaseTo(validAt);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // try to close vault - announce pool token redemption and class 1 collateral withdrawal
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).gtn(0)).to.be.true;
        expect(toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gtn(0)).to.be.true;
        // try to close vault - redeem pool tokens and withdraw class 1 collateral
        await time.increaseTo(maxBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp, agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp));
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.destroyPoolTokenRedemptionWithdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        // try to close vault - close
        await agentBot.handleTimelockedProcesses(orm.em);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.DESTROYING);
    });

    it("Should confirm underlying withdrawal announcement", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, undefined, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // announce
        const resp = await agentBot.agent.announceUnderlyingWithdrawal();
        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = await latestBlockTimestampBN();
        await orm.em.persist(agentEnt).flush();
        // pay
        const paymentAmount = toBN(100);
        await fundUnderlying(context, agentBot.agent.underlyingAddress, paymentAmount);
        const tx = await agentBot.agent.performPayment("SomeRandomUnderlyingAddress", paymentAmount, resp.paymentReference);
        agentEnt.underlyingWithdrawalConfirmTransaction = tx;
        // confirmation not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gtn(0)).to.be.true;
        // confirmation allowed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eqn(0)).to.be.true;
    });

    it("Should ignore 'MintingExecuted' when self mint", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, undefined, false);
        const lots = 3;
        // convert lots in uba
        const amountUBA = toBN(lots).mul(getLotSize(await context.assetManager.getSettings()));
        const agentSettings = await agentBot.agent.getAgentSettings();
        const poolFee = amountUBA.mul(toBN(agentSettings.feeBIPS)).mul(toBN(agentSettings.poolFeeShareBIPS));

        const allAmountUBA = amountUBA.add(poolFee);
        await fundUnderlying(context, randomUnderlyingAddress, allAmountUBA);
        // self mint
        const transactionHash = await agentBot.agent.wallet.addTransactionAndWaitForItsFinalization(
            randomUnderlyingAddress,
            agentBot.agent.underlyingAddress,
            allAmountUBA,
            PaymentReference.selfMint(agentBot.agent.vaultAddress)
        );
        const proof = await agentBot.agent.attestationProvider.provePayment(transactionHash, null, agentBot.agent.underlyingAddress);
        const res = await agentBot.agent.assetManager.selfMint(proof, agentBot.agent.agentVault.address, lots, { from: agentBot.agent.owner.workAddress });
        const selfMint = requiredEventArgs(res, "MintingExecuted");
        expect(selfMint.collateralReservationId.isZero()).to.be.true;
        await agentBot.runStep(orm.em);
        // check
        const mintings = await orm.em.createQueryBuilder(AgentMinting).where({ agentAddress: agentBot.agent.vaultAddress }).getResultList();
        expect(mintings.length).to.eq(0);
    });

    it("Should cancel underlying withdrawal announcement", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, undefined, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // announce
        await agentBot.agent.announceUnderlyingWithdrawal();
        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = await latestBlockTimestampBN();
        agentEnt.underlyingWithdrawalWaitingForCancelation = true;
        await orm.em.persist(agentEnt).flush();
        // cancelation not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gtn(0)).to.be.true;
        // cancelation allowed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(agentEnt.underlyingWithdrawalWaitingForCancelation).to.be.false;
    });

    it("Should not request proofs - cannot prove requests yet", async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        chain.mine(3);
        // minting
        const minting: AgentMinting = {
            id: 3,
            state: AgentMintingState.STARTED,
            agentAddress: "0xb4B20F08a1F41dE1f31Bc288C1D998fAd2Bd9F59",
            agentUnderlyingAddress: "UNDERLYING_ACCOUNT_25377",
            requestId: toBN(232),
            valueUBA: toBN(20000000000),
            feeUBA: toBN(2000000000),
            firstUnderlyingBlock: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "0x46425052664100010000000000000000000000000000000000000000000000e8",
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await context.agentOwnerRegistry.setWorkAddress(accounts[4], { from: ownerAddress });
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, undefined, false);
        // switch attestation prover to always fail mode
        checkedCast(agentBot.agent.attestationProvider.stateConnector, MockStateConnectorClient).useAlwaysFailsProver = true;
        //
        await agentBot.minting.requestNonPaymentProofForMinting(orm.em, minting)
            .catch(e => console.error(e));
        expect(minting.state).to.eq("started");
        const transactionHash = await agentBot.agent.wallet.addTransactionAndWaitForItsFinalization(
            randomUnderlyingAddress,
            agentBot.agent.underlyingAddress,
            1,
            PaymentReference.selfMint(agentBot.agent.vaultAddress)
        );
        await agentBot.minting.requestPaymentProofForMinting(orm.em, minting, transactionHash, randomUnderlyingAddress)
            .catch(e => console.error(e));
        expect(minting.state).to.eq("started");
        const transactionHash1 = await agentBot.agent.wallet.addTransactionAndWaitForItsFinalization(
            agentBot.agent.underlyingAddress,
            randomUnderlyingAddress,
            1,
            PaymentReference.selfMint(agentBot.agent.vaultAddress)
        );
        // redemption
        const redemption: AgentRedemption = {
            id: 3,
            state: AgentRedemptionState.PAID,
            agentAddress: "0xb4B20F08a1F41dE1f31Bc288C1D998fAd2Bd9F59",
            paymentAddress: randomUnderlyingAddress,
            requestId: toBN(232),
            valueUBA: toBN(20000000000),
            feeUBA: toBN(2000000000),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "0x46425052664100010000000000000000000000000000000000000000000000e8",
            txHash: transactionHash1,
            createdAt: new Date(),
            updatedAt: new Date()
        };
        await agentBot.redemption.requestPaymentProof(orm.em, redemption)
            .catch(e => console.error(e));
        expect(redemption.state).to.eq("paid");
        // handleDailyTasks
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const lastHandledTimestamp = Number(agentEnt.dailyTasksTimestamp);
        expect(Number(agentBot.transientStorage.waitingForLatestBlockProofSince)).to.be.equal(0);
        await agentBot.handleDailyTasks(orm.em);
        expect(Number(agentBot.transientStorage.waitingForLatestBlockProofSince)).not.to.be.equal(0);
        orm.em.clear();
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(Number(agentEnt2.dailyTasksTimestamp)).to.be.equal(lastHandledTimestamp);
    });

    it("Should not handle claims (FTSO rewards) - no contracts", async () => {
        const spyError = spy.on(console, "error");
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        await agentBot.claims.checkForClaims();
        expect(spyError).to.be.called.exactly(2);
    });

    it("Should not handle claims - stop requested", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyError = spy.on(agentBot, "stopRequested");
        agentBot.requestStop();
        await agentBot.claims.checkForClaims();
        expect(spyError).to.be.called.exactly(4);
    });

    it("Should handle claims", async () => {
        const spyError = spy.on(console, "error");
        // create agent bot
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        // necessary contracts
        const MockContract = artifacts.require("MockContract");
        const FtsoRewardManager = artifacts.require("IFtsoRewardManager");
        const DistributionToDelegators = artifacts.require("DistributionToDelegators");
        // mock contracts
        const mockContractFtsoManager = await MockContract.new();
        const ftsoRewardManager = await FtsoRewardManager.at(mockContractFtsoManager.address);
        const mockContractDistribution = await MockContract.new();
        const distributionToDelegators = await DistributionToDelegators.at(mockContractDistribution.address);
        // add contracts to address updater
        await agentBot.context.addressUpdater.addOrUpdateContractNamesAndAddresses(["FtsoRewardManager"], [ftsoRewardManager.address]);
        await agentBot.context.addressUpdater.addOrUpdateContractNamesAndAddresses(["DistributionToDelegators"], [distributionToDelegators.address]);
        // mock functions - there is something to claim
        const getEpochs1 = web3.eth.abi.encodeFunctionCall(
            { type: "function", name: "getEpochsWithUnclaimedRewards", inputs: [{ name: "_beneficiary", type: "address" }] },
            [agentBot.agent.collateralPool.address]
        );
        const epochs1 = web3.eth.abi.encodeParameter("uint256[]", [150]);
        await mockContractFtsoManager.givenMethodReturn(getEpochs1, epochs1);
        const getMonth1 = web3.eth.abi.encodeFunctionCall({ type: "function", name: "getClaimableMonths", inputs: [] }, []);
        const month = web3.eth.abi.encodeParameters(["uint256", "uint256"], [0, 1]);
        await mockContractDistribution.givenMethodReturn(getMonth1, month);
        const getAmountToClaim1 = web3.eth.abi.encodeFunctionCall(
            {
                type: "function",
                name: "getClaimableAmountOf",
                inputs: [
                    { name: "_account", type: "address" },
                    { name: "_month", type: "uint256" },
                ],
            },
            [agentBot.agent.collateralPool.address, month]
        );
        const amountToClaim1 = web3.eth.abi.encodeParameter("uint256", 15000);
        await mockContractDistribution.givenMethodReturn(getAmountToClaim1, amountToClaim1);
        // check
        await agentBot.claims.checkForClaims();
        // mock functions - there is nothing to claim
        const getEpochs2 = web3.eth.abi.encodeFunctionCall(
            { type: "function", name: "getEpochsWithUnclaimedRewards", inputs: [{ name: "_beneficiary", type: "address" }] },
            [agentBot.agent.collateralPool.address]
        );
        const empty = web3.eth.abi.encodeParameter("uint256[]", []);
        await mockContractFtsoManager.givenMethodReturn(getEpochs2, empty);
        const amountToClaim0 = web3.eth.abi.encodeParameter("uint256", 0);
        await mockContractDistribution.givenMethodReturn(getAmountToClaim1, amountToClaim0);
        // check
        await agentBot.claims.checkForClaims();
        expect(spyError).to.be.called.exactly(0);
        // clean up
        await agentBot.context.addressUpdater.removeContracts(["FtsoRewardManager"]);
        await agentBot.context.addressUpdater.removeContracts(["DistributionToDelegators"]);
    });

    it("Should redeem pool tokens", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const amount = toBN(100000000000000000000);
        await agentBot.agent.buyCollateralPoolTokens(amount);
        const withdrawalAllowedAt = await agentBot.agent.announcePoolTokenRedemption(amount);
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = amount.toString();
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).eq(withdrawalAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(withdrawalAllowedAt);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        const poolTokensBalance = (await agentBot.agent.getAgentInfo()).totalAgentPoolTokensWei;
        expect(poolTokensBalance).to.eq("0");
    });

    it("Should not redeem pool tokens - more than announced", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const amount = toBN(100000000000000000000);
        await agentBot.agent.buyCollateralPoolTokens(amount);
        const withdrawalAllowedAt = await agentBot.agent.announcePoolTokenRedemption(amount);
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = amount.addn(1).toString();
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).eq(withdrawalAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(withdrawalAllowedAt);
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).eqn(0)).to.be.false;
        const poolTokensBalance = (await agentBot.agent.getAgentInfo()).totalAgentPoolTokensWei;
        expect(poolTokensBalance).to.eq(amount.toString());
    });

    it("Should not redeem pool tokens - too late", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const amount = toBN(100000000000000000000);
        await agentBot.agent.buyCollateralPoolTokens(amount);
        const withdrawalAllowedAt = await agentBot.agent.announcePoolTokenRedemption(amount);
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount = amount.toString();
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).eq(withdrawalAllowedAt)).to.be.true;
        // allowed
        const agentTimelockedOperationWindowSeconds = toBN((await context.assetManager.getSettings()).agentTimelockedOperationWindowSeconds);
        await time.increaseTo(withdrawalAllowedAt.add(agentTimelockedOperationWindowSeconds));
        await agentBot.handleTimelockedProcesses(orm.em);
        expect(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        const poolTokensBalance = (await agentBot.agent.getAgentInfo()).totalAgentPoolTokensWei;
        expect(poolTokensBalance).to.eq(amount.toString());
    });

    it("Should not do next underlying payment step due to invalid underlying payment state", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyLog = spy.on(console, "error");
        // create underlying payment with invalid state
        const up = new AgentUnderlyingPayment();
        up.state = "invalid" as AgentUnderlyingPaymentState;
        up.agentAddress = agentBot.agent.vaultAddress;
        up.type = AgentUnderlyingPaymentType.TOP_UP;
        up.txHash = "hash";
        up.proofRequestRound = 1;
        up.proofRequestData = "data";
        await orm.em.persistAndFlush(up);
        await agentBot.underlyingManagement.nextUnderlyingPaymentStep(orm.em, up.id);
        expect(spyLog).to.have.been.called.once;
    });

    it("Should not do next underlying payment step due to underlying payment not found in db", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
        const spyLog = spy.on(console, "error");
        await agentBot.underlyingManagement.nextUnderlyingPaymentStep(orm.em, 1000);
        expect(spyLog).to.have.been.called.once;
    });

    // it("Should properly order redemptions by priority", async () => {
    //     const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, false);
    //     const states = Object.values(AgentRedemptionState);
    //     let countStarted = 0;
    //     for (let i = 0; i < 20; i++) {
    //         const rd = orm.em.create(
    //             AgentRedemption,
    //             {
    //                 state: states[i % states.length],
    //                 agentAddress: agentBot.agent.vaultAddress,
    //                 requestId: toBN(i),
    //                 paymentAddress: "payment_address_" + i,
    //                 valueUBA: toBN(1000 + i),
    //                 feeUBA: toBN(100 + i),
    //                 paymentReference: "reefrence_" + i,
    //                 lastUnderlyingBlock: toBN(100),
    //                 lastUnderlyingTimestamp: toBN(100),
    //             } as RequiredEntityData<AgentRedemption>,
    //             { persist: true }
    //         );
    //         if (rd.state === AgentRedemptionState.STARTED) countStarted++;
    //     }
    //     await orm.em.flush();
    //     orm.em.clear();
    //     // check
    //     const M = 5;
    //     agentBot.redemption.handleMaxNonPriorityRedemptions = M;
    //     const redemptions = await agentBot.redemption.redemptionsInState(orm.em, true);
    //     // console.log(redemptions);
    //     assert.equal(redemptions.length, countStarted + M);
    // });
});
