import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, requireEnv, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { FilterQuery } from "@mikro-orm/core";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState } from "../../../src/entities/agent";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { time } from "@openzeppelin/test-helpers";
import { Notifier } from "../../../src/utils/Notifier";
import spies from "chai-spies";
import { expect, spy, use } from "chai";
import { createTestAgentBot, createTestAgentBotAndMakeAvailable, disableMccTraceManager, mintClass1ToOwner } from "../../test-utils/helpers";
import { AgentStatus } from "../../../src/fasset/AssetManagerTypes";
import { latestBlockTimestampBN } from "../../../src/utils/web3helpers";
use(spies);

describe("Agent bot unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let ownerUnderlyingAddress: string;
    let chain: MockChain;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        // accounts
        ownerAddress = accounts[3];
        ownerUnderlyingAddress = requireEnv('OWNER_UNDERLYING_ADDRESS');
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create agent bot", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
        expect(agentBot.agent.underlyingAddress).to.not.be.null;
    });

    it("Should read agent bot from entity", async () => {
        const agentBotBefore = await createTestAgentBot(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBotBefore.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentEnt, new Notifier());
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });

    it("Should run readUnhandledEvents", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const events = await agentBot.readUnhandledEvents(orm.em);
        expect(events.length).to.eq(0);
    });

    it("Should top up collateral", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyTop = spy.on(agentBot, 'requiredTopUp');
        await agentBot.checkAgentForCollateralRatiosAndTopUp();
        expect(spyTop).to.have.been.called.twice;
    });

    it("Should top up underlying - failed", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const ownerAmount = 100;
        context.chain.mint(ownerUnderlyingAddress, ownerAmount);
        const spyBalance = spy.on(agentBot.notifier, 'sendLowUnderlyingAgentBalanceFailed');
        const topUpAmount = 420;
        await agentBot.underlyingTopUp(toBN(topUpAmount), agentBot.agent.vaultAddress, toBN(1));
        expect(spyBalance).to.have.been.called.once;
    });

    it("Should top up underlying", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyBalance0 = spy.on(agentBot.notifier, 'sendLowUnderlyingAgentBalance');
        const spyBalance1 = spy.on(agentBot.notifier, 'sendLowBalanceOnUnderlyingOwnersAddress');
        const ownerAmount = 100;
        context.chain.mint(ownerUnderlyingAddress, ownerAmount);
        await agentBot.underlyingTopUp(toBN(ownerAmount), agentBot.agent.vaultAddress, toBN(1));
        expect(spyBalance0).to.have.been.called.once;
        expect(spyBalance1).to.have.been.called.once;
    });

    it("Should prove EOA address", async () => {
        const spyEOA = spy.on(AgentBot, 'proveEOAaddress');
        const contextEOAProof = await createTestAssetContext(accounts[0], testChainInfo.xrp, true);
        await createTestAgentBot(contextEOAProof, orm, ownerAddress);
        expect(spyEOA).to.have.been.called.once;
    });

    it("Should not do next redemption step due to invalid redemption state", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyLog = spy.on(console, 'error');
        // create redemption with invalid state
        const rd = orm.em.create(AgentRedemption, {
            state: 'invalid' as AgentRedemptionState,
            agentAddress: "",
            requestId: "",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0)
        });
        await agentBot.nextRedemptionStep(orm.em, rd.id);
        await orm.em.persistAndFlush(rd);
        await agentBot.nextRedemptionStep(orm.em, rd.id);
        expect(spyLog).to.have.been.called.twice;
    });

    it("Should not do next minting step due to invalid minting state", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyLog = spy.on(console, 'error');
        // create minting with invalid state
        const mt = orm.em.create(AgentMinting, {
            state: 'invalid' as AgentMintingState,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: ""
        });
        await agentBot.nextMintingStep(orm.em, mt.id);
        await orm.em.persistAndFlush(mt);
        await agentBot.nextMintingStep(orm.em, mt.id);
        expect(spyLog).to.have.been.called.twice;
    });

    it("Should return open redemptions", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        // create redemptions
        const rd1 = orm.em.create(AgentRedemption, {
            state: AgentRedemptionState.STARTED,
            agentAddress: agentBot.agent.vaultAddress,
            requestId: "000",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0)
        });
        const rd2 = orm.em.create(AgentRedemption, {
            state: AgentRedemptionState.DONE,
            agentAddress: agentBot.agent.vaultAddress,
            requestId: "001",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0)
        });
        await orm.em.persistAndFlush([rd1, rd2]);
        const ids = await agentBot.openRedemptions(orm.em, true);
        const rds = await agentBot.openRedemptions(orm.em, false);
        expect(ids.length).to.eq(1);
        expect(rds.length).to.eq(1);
    });

    it("Should not receive proof 1 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.context.attestationProvider, 'obtainReferencedPaymentNonexistenceProof');
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_NON_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 1,
            proofRequestData: ""
        });
        await agentBot.checkNonPayment(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 2 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.context.attestationProvider, 'obtainPaymentProof');
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 1,
            proofRequestData: ""
        });
        await agentBot.checkPaymentAndExecuteMinting(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 3 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.context.attestationProvider, 'obtainPaymentProof');
        // create redemption
        const rd = orm.em.create(AgentRedemption, {
            state: AgentRedemptionState.REQUESTED_PROOF,
            agentAddress: agentBot.agent.vaultAddress,
            requestId: "003",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            proofRequestRound: 1,
            proofRequestData: ""
        });
        await agentBot.checkConfirmPayment(rd);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 1 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof();
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.notifier, 'sendNoProofObtained');
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_NON_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 0,
            proofRequestData: ""
        });
        await agentBot.checkNonPayment(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 2 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof();
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.notifier, 'sendNoProofObtained');
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 0,
            proofRequestData: ""
        });
        await agentBot.checkPaymentAndExecuteMinting(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 3 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof();
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.notifier, 'sendNoProofObtained');
        // create redemption
        const rd = orm.em.create(AgentRedemption, {
            state: AgentRedemptionState.REQUESTED_PROOF,
            agentAddress: agentBot.agent.vaultAddress,
            requestId: "003",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            proofRequestRound: 0,
            proofRequestData: ""
        });
        await agentBot.checkConfirmPayment(rd);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should destruct agent", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const destroyAllowedAt = await agentBot.agent.announceDestroy();
        agentEnt.waitingForDestructionTimestamp = destroyAllowedAt;
        const agentInfo = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfo.status).toNumber()).to.eq(AgentStatus.DESTROYING);
        // not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.waitingForDestructionTimestamp.eq(destroyAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(destroyAllowedAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.waitingForDestructionTimestamp.eqn(0)).to.be.true;
    });

    it("Should withdraw collateral", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const amount = toBN(10000);
        const class1TokenAddress = (await agentBot.agent.getClass1CollateralToken()).token;
        await mintClass1ToOwner(agentBot.agent.vaultAddress, amount, class1TokenAddress, ownerAddress);
        await agentBot.agent.depositClass1Collateral(amount);
        const withdrawalAllowedAt = await agentBot.agent.announceClass1CollateralWithdrawal(amount);
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = amount.toString();
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.withdrawalAllowedAtTimestamp.eq(withdrawalAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(withdrawalAllowedAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.withdrawalAllowedAtTimestamp.eqn(0)).to.be.true;
        const agentCollateral = await agentBot.agent.getAgentCollateral();
        expect((agentCollateral.class1.balance).eqn(0)).to.be.true;
    });

    it("Should update agent settings", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const settingName = "feeBIPS";
        const settingValue = "1100";
        const validAt = await agentBot.agent.announceAgentSettingUpdate(settingName, settingValue);
        agentEnt.agentSettingUpdateValidAtTimestamp = validAt;
        agentEnt.agentSettingUpdateValidAtName = settingName;
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.agentSettingUpdateValidAtTimestamp.eq(validAt)).to.be.true;
        // allowed
        await time.increaseTo(validAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.agentSettingUpdateValidAtTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.agentSettingUpdateValidAtName).to.eq("");
    });

    it("Should exit available", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const validAt = await agentBot.agent.announceExitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = validAt;
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.eq(validAt)).to.be.true;
        // allowed
        await time.increaseTo(validAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.eqn(0)).to.be.true;
    });

    it("Should run handleAgentsWaitingsAndCleanUp and change nothing", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.false;
        expect(agentEnt.waitingForDestructionTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.withdrawalAllowedAtTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.withdrawalAllowedAtAmount).to.eq("");
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.false;
        expect(agentEnt.waitingForDestructionTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.withdrawalAllowedAtTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.withdrawalAllowedAtAmount).to.eq("");
    });

    it("Should exit available before closing vault", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        agentEnt.waitingForDestructionCleanUp = true;
        const validAt = await agentBot.agent.announceExitAvailable();
        agentEnt.exitAvailableAllowedAtTimestamp = validAt;
        await orm.em.persist(agentEnt).flush();
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        // not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.eq(validAt)).to.be.true;
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // allowed
        await time.increaseTo(validAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // try to close vault - announce class 1 withdrawal
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.destroyClass1WithdrawalAllowedAtTimestamp.gtn(0)).to.be.true;
        // try to close vault - withdraw class 1
        await time.increaseTo(agentEnt.destroyClass1WithdrawalAllowedAtTimestamp);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount).to.eq("");
        // try to close vault - announce pool tokens redemption
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp.gtn(0)).to.be.true;
        // try to close vault - redeem pool tokens redemption
        await time.increaseTo(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp.eqn(0)).to.be.true;
        expect(agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount).to.eq("");
        // try to close vault
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
    });

    it("Should confirm underlying withdrawal", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // announce
        const resp = await agentBot.agent.announceUnderlyingWithdrawal();
        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = await latestBlockTimestampBN();
        await orm.em.persist(agentEnt).flush();
        // pay
        const tx = await agentBot.agent.performUnderlyingWithdrawal(resp.paymentReference, 100, "SomeRandomUnderlyingAddress");
        agentEnt.underlyingWithdrawalConfirmTransaction = tx;
        // confirmation not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp.gtn(0)).to.be.true;
        // confirmation allowed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.eqn(0)).to.be.true;
    });
});