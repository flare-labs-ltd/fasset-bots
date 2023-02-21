import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, requireEnv, toBN } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { FilterQuery } from "@mikro-orm/core";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState } from "../../../src/entities/agent";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

describe("Agent bot unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let ownerUnderlyingAddress: string;
    let chain: MockChain;

    before(async () => {
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
        chai.spy.restore(console);
    });

    it("Should create agent bot", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
        expect(agentBot.agent.underlyingAddress).to.not.be.null;
    });

    it("Should read agent bot from entity", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { ownerAddress: ownerAddress } as FilterQuery<AgentEntity>);
        const agentBot = await AgentBot.fromEntity(context, agentEnt)
        expect(agentBot.agent.underlyingAddress).is.not.null;
        expect(agentBot.agent.ownerAddress).to.eq(ownerAddress);
    });

    it("Should top up collateral", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot, 'requiredTopUp');
        await agentBot.checkAgentForCollateralRatioAndTopUp();
        expect(spy).to.have.been.called.once;
    });

    it("Should top up underlying - failed", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const ownerAmount = 100;
        context.chain.mint(ownerUnderlyingAddress, ownerAmount);
        const spy = chai.spy.on(agentBot.notifier, 'sendLowUnderlyingAgentBalanceFailed');
        const topUpAmount = 420;
        await agentBot.underlyingTopUp(toBN(topUpAmount), agentBot.agent.vaultAddress, toBN(1));
        expect(spy).to.have.been.called.once;
    });

    it("Should top up underlying", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot.notifier, 'sendLowUnderlyingAgentBalance');
        const spy2 = chai.spy.on(agentBot.notifier, 'sendLowBalanceOnUnderlyingOwnersAddress');
        const ownerAmount = 100;
        context.chain.mint(ownerUnderlyingAddress, ownerAmount);
        await agentBot.underlyingTopUp(toBN(ownerAmount), agentBot.agent.vaultAddress, toBN(1));
        expect(spy).to.have.been.called.once;
        expect(spy2).to.have.been.called.once;
    });

    it("Should prove EOA address", async () => {
        const spy = chai.spy.on(AgentBot, 'proveEOAaddress');
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, true, true);
        await AgentBot.create(orm.em, context, ownerAddress);
        expect(spy).to.have.been.called.once;
    });

    it("Should not do next redemption step due to invalid redemption state", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(console, 'error');
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
        expect(spy).to.have.been.called.twice;
    });

    it("Should not do next minting step due to invalid minting state", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(console, 'error');
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
        expect(spy).to.have.been.called.twice;
    });

    it("Should return open redemptions", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
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
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot.context.attestationProvider, 'obtainReferencedPaymentNonexistenceProof');
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
        expect(spy).to.have.been.called.once;
    });

    it("Should not receive proof 2 - not finalized", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot.context.attestationProvider, 'obtainPaymentProof');
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
        expect(spy).to.have.been.called.once;
    });

    it("Should not receive proof 3 - not finalized", async () => {
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot.context.attestationProvider, 'obtainPaymentProof');
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
        expect(spy).to.have.been.called.once;
    });

    it("Should not receive proof 1 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof();
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot.notifier, 'sendNoProofObtained');
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
        expect(spy).to.have.been.called.once;
    });

    it("Should not receive proof 2 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof();
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot.notifier, 'sendNoProofObtained');
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
        expect(spy).to.have.been.called.once;
    });

    it("Should not receive proof 3 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof();
        const agentBot = await AgentBot.create(orm.em, context, ownerAddress);
        const spy = chai.spy.on(agentBot.notifier, 'sendNoProofObtained');
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
        expect(spy).to.have.been.called.once;
    });

});