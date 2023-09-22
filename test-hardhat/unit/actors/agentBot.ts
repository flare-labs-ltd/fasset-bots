import { AgentBot } from "../../../src/actors/AgentBot";
import { ORM } from "../../../src/config/orm";
import { MockChain } from "../../../src/mock/MockChain";
import { checkedCast, requireEnv, toBN } from "../../../src/utils/helpers";
import { artifacts, web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { FilterQuery } from "@mikro-orm/core";
import { AgentEntity, AgentMinting, AgentMintingState, AgentRedemption, AgentRedemptionState, DailyProofState } from "../../../src/entities/agent";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { time } from "@openzeppelin/test-helpers";
import { Notifier } from "../../../src/utils/Notifier";
import spies from "chai-spies";
import { assert, expect, spy, use } from "chai";
import { createTestAgentBot, createTestAgentBotAndMakeAvailable, disableMccTraceManager, mintVaultCollateralToOwner } from "../../test-utils/helpers";
import { AgentStatus } from "../../../src/fasset/AssetManagerTypes";
import { latestBlockTimestampBN } from "../../../src/utils/web3helpers";
import { getLotSize } from "../../test-utils/fuzzing-utils";
import { PaymentReference } from "../../../src/fasset/PaymentReference";
import { requiredEventArgs } from "../../../src/utils/events/truffle";
import { attestationWindowSeconds } from "../../../src/utils/fasset-helpers";
import { MockAgentBot } from "../../../src/mock/MockAgentBot";
import { Agent } from "../../../src/fasset/Agent";
use(spies);

const randomUnderlyingAddress = "RANDOM_UNDERLYING";
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
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", type: "sqlite" }));
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        // accounts
        ownerAddress = accounts[3];
        ownerUnderlyingAddress = requireEnv("OWNER_UNDERLYING_ADDRESS");
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
        const spyTop = spy.on(agentBot, "requiredTopUp");
        await agentBot.checkAgentForCollateralRatiosAndTopUp();
        expect(spyTop).to.have.been.called.twice;
    });

    it("Should top up underlying - failed", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const balance = context.blockchainIndexer.chain.getBalance(ownerUnderlyingAddress);
        const spyBalance = spy.on(agentBot.notifier, "sendLowUnderlyingAgentBalanceFailed");
        const topUpAmount = (await balance).addn(1);
        await agentBot.underlyingTopUp(toBN(topUpAmount), agentBot.agent.vaultAddress, toBN(1));
        expect(spyBalance).to.have.been.called.once;
    });

    it("Should top up underlying", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyBalance0 = spy.on(agentBot.notifier, "sendLowUnderlyingAgentBalance");
        const spyBalance1 = spy.on(agentBot.notifier, "sendLowBalanceOnUnderlyingOwnersAddress");
        const balance = await context.blockchainIndexer.chain.getBalance(ownerUnderlyingAddress);
        await agentBot.underlyingTopUp(toBN(balance), agentBot.agent.vaultAddress, toBN(1));
        expect(spyBalance0).to.have.been.called.once;
        expect(spyBalance1).to.have.been.called.once;
    });

    it("Should prove EOA address", async () => {
        const spyEOA = spy.on(AgentBot, "proveEOAaddress");
        const contextEOAProof = await createTestAssetContext(accounts[0], testChainInfo.xrp, true);
        await createTestAgentBot(contextEOAProof, orm, ownerAddress);
        expect(spyEOA).to.have.been.called.once;
    });

    it("Should not do next redemption step due to invalid redemption state", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyLog = spy.on(console, "error");
        // create redemption with invalid state
        const rd = orm.em.create(AgentRedemption, {
            state: "invalid" as AgentRedemptionState,
            agentAddress: "",
            requestId: "",
            paymentAddress: "",
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            paymentReference: "",
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
        });
        await orm.em.persistAndFlush(rd);
        await agentBot.nextRedemptionStep(orm.em, rd.id);
        expect(spyLog).to.have.been.called.once;
    });

    it("Should not do next redemption step due to redemption not found in db", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyLog = spy.on(console, "error");
        await agentBot.nextRedemptionStep(orm.em, 1000);
        expect(spyLog).to.have.been.called.once;
    });

    it("Should not do next minting step due to invalid minting state", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyLog = spy.on(console, "error");
        // create minting with invalid state
        const mt = orm.em.create(AgentMinting, {
            state: "invalid" as AgentMintingState,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            firstUnderlyingBlock: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
        });
        await orm.em.persistAndFlush(mt);
        await agentBot.nextMintingStep(orm.em, mt.id);
        expect(spyLog).to.have.been.called.once;
    });

    it("Should not do next minting step due to minting not found in db", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyLog = spy.on(console, "error");
        await agentBot.nextMintingStep(orm.em, 1000);
        expect(spyLog).to.have.been.called.once;
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
            lastUnderlyingTimestamp: toBN(0),
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
            lastUnderlyingTimestamp: toBN(0),
        });
        await orm.em.persistAndFlush([rd1, rd2]);
        const ids = await agentBot.openRedemptions(orm.em, true);
        const rds = await agentBot.openRedemptions(orm.em, false);
        expect(ids.length).to.eq(1);
        expect(rds.length).to.eq(1);
    });

    it("Should not receive proof 1 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainReferencedPaymentNonexistenceProof");
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_NON_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            firstUnderlyingBlock: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 1,
            proofRequestData: "",
        });
        await agentBot.checkNonPayment(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 2 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainPaymentProof");
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            firstUnderlyingBlock: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 1,
            proofRequestData: "",
        });
        await agentBot.checkPaymentAndExecuteMinting(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 3 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainPaymentProof");
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
            proofRequestData: "",
        });
        await agentBot.checkConfirmPayment(rd);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 4 - not finalized", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.context.attestationProvider, "obtainConfirmedBlockHeightExistsProof");
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        agentEnt.dailyProofRequestData = "";
        agentEnt.dailyProofRequestRound = 1;
        agentEnt.dailyProofState = DailyProofState.WAITING_PROOF;
        await agentBot.handleDailyTasks(orm.em);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 1 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.notifier, "sendNoProofObtained");
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_NON_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            firstUnderlyingBlock: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 0,
            proofRequestData: "",
        });
        await agentBot.checkNonPayment(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 2 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.notifier, "sendNoProofObtained");
        // create minting
        const mt = orm.em.create(AgentMinting, {
            state: AgentMintingState.REQUEST_PAYMENT_PROOF,
            agentAddress: "",
            agentUnderlyingAddress: "",
            requestId: toBN(0),
            valueUBA: toBN(0),
            feeUBA: toBN(0),
            firstUnderlyingBlock: toBN(0),
            lastUnderlyingBlock: toBN(0),
            lastUnderlyingTimestamp: toBN(0),
            paymentReference: "",
            proofRequestRound: 0,
            proofRequestData: "",
        });
        await agentBot.checkPaymentAndExecuteMinting(mt);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 3 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.notifier, "sendNoProofObtained");
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
            proofRequestData: "",
        });
        await agentBot.checkConfirmPayment(rd);
        expect(spyProof).to.have.been.called.once;
    });

    it("Should not receive proof 4 - no proof", async () => {
        await context.attestationProvider.requestConfirmedBlockHeightExistsProof(await attestationWindowSeconds(context));
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const spyProof = spy.on(agentBot.notifier, "sendNoProofObtained");
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        agentEnt.dailyProofRequestData = "";
        agentEnt.dailyProofRequestRound = 0;
        agentEnt.dailyProofState = DailyProofState.WAITING_PROOF;
        await agentBot.handleDailyTasks(orm.em);
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
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eq(destroyAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(destroyAllowedAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
    });

    it("Should withdraw collateral", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        const amount = toBN(10000);
        const vaultCollateralTokenAddress = (await agentBot.agent.getVaultCollateral()).token;
        await mintVaultCollateralToOwner(amount, vaultCollateralTokenAddress, ownerAddress);
        await agentBot.agent.depositVaultCollateral(amount);
        const withdrawalAllowedAt = await agentBot.agent.announceVaultCollateralWithdrawal(amount);
        agentEnt.withdrawalAllowedAtTimestamp = withdrawalAllowedAt;
        agentEnt.withdrawalAllowedAtAmount = amount.toString();
        await orm.em.persist(agentEnt).flush();
        // not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eq(withdrawalAllowedAt)).to.be.true;
        // allowed
        await time.increaseTo(withdrawalAllowedAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        const agentVaultCollateralBalance = (await agentBot.agent.getAgentInfo()).totalVaultCollateralWei;
        expect(agentVaultCollateralBalance).to.eq("0");
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
        expect(toBN(agentEnt.agentSettingUpdateValidAtTimestamp).eq(validAt)).to.be.true;
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
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eq(validAt)).to.be.true;
        // allowed
        await time.increaseTo(validAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.eqn(0)).to.be.true;
    });

    it("Should run handleAgentsWaitingsAndCleanUp and change nothing", async () => {
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.false;
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(agentEnt.withdrawalAllowedAtAmount).to.eq("");
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.false;
        expect(toBN(agentEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
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
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eq(validAt)).to.be.true;
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // allowed
        await time.increaseTo(validAt);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // try to close vault - announce class 1 withdrawal
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).gtn(0)).to.be.true;
        // try to close vault - withdraw class 1
        await time.increaseTo(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.destroyVaultCollateralWithdrawalAllowedAtTimestamp).eqn(0)).to.be.true;
        // try to close vault - close
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.DESTROYING);
    });

    it("Should confirm underlying withdrawal announcement", async () => {
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
        expect(toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gtn(0)).to.be.true;
        // confirmation allowed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eqn(0)).to.be.true;
    });

    it("Should ignore 'MintingExecuted' when self mint", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const lots = 3;
        // convert lots in uba
        const amountUBA = toBN(lots).mul(getLotSize(await context.assetManager.getSettings()));
        const agentSettings = await agentBot.agent.getAgentSettings();
        const poolFee = amountUBA.mul(toBN(agentSettings.feeBIPS)).mul(toBN(agentSettings.poolFeeShareBIPS));

        const allAmountUBA = amountUBA.add(poolFee);
        context.blockchainIndexer.chain.mint(randomUnderlyingAddress, allAmountUBA);
        // self mint
        const transactionHash = await agentBot.agent.wallet.addTransaction(
            randomUnderlyingAddress,
            agentBot.agent.underlyingAddress,
            allAmountUBA,
            PaymentReference.selfMint(agentBot.agent.vaultAddress)
        );
        const proof = await agentBot.agent.attestationProvider.provePayment(transactionHash, null, agentBot.agent.underlyingAddress);
        const res = await agentBot.agent.assetManager.selfMint(proof, agentBot.agent.agentVault.address, lots, { from: agentBot.agent.ownerAddress });
        const selfMint = requiredEventArgs(res, "MintingExecuted");
        expect(selfMint.collateralReservationId.isZero()).to.be.true;
        await agentBot.runStep(orm.em);
        // check
        const mintings = await orm.em.createQueryBuilder(AgentMinting).where({ agentAddress: agentBot.agent.vaultAddress }).getResultList();
        expect(mintings.length).to.eq(0);
    });

    it("Should cancel underlying withdrawal announcement", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // announce
        await agentBot.agent.announceUnderlyingWithdrawal();
        agentEnt.underlyingWithdrawalAnnouncedAtTimestamp = await latestBlockTimestampBN();
        agentEnt.underlyingWithdrawalWaitingForCancelation = true;
        await orm.em.persist(agentEnt).flush();
        // cancelation not yet allowed
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.underlyingWithdrawalAnnouncedAtTimestamp).gtn(0)).to.be.true;
        // cancelation allowed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await agentBot.handleAgentsWaitingsAndCleanUp(orm.em);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).eqn(0)).to.be.true;
        expect(agentEnt.underlyingWithdrawalWaitingForCancelation).to.be.false;
    });

    it("Should not request proofs - cannot prove requests yet", async () => {
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp, undefined, undefined, undefined, true);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        chain.mine(3);
        // minting
        const minting = {
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
        };
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        await agentBot.requestNonPaymentProofForMinting(minting);
        expect(minting.state).to.eq("started");
        const transactionHash = await agentBot.agent.wallet.addTransaction(
            randomUnderlyingAddress,
            agentBot.agent.underlyingAddress,
            1,
            PaymentReference.selfMint(agentBot.agent.vaultAddress)
        );
        await agentBot.requestPaymentProofForMinting(minting, transactionHash, randomUnderlyingAddress);
        expect(minting.state).to.eq("started");
        const transactionHash1 = await agentBot.agent.wallet.addTransaction(
            agentBot.agent.underlyingAddress,
            randomUnderlyingAddress,
            1,
            PaymentReference.selfMint(agentBot.agent.vaultAddress)
        );
        // redemption
        const redemption = {
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
        };
        await agentBot.requestPaymentProof(redemption);
        expect(redemption.state).to.eq("paid");
        // handleDailyTasks
        expect(agentBot.latestProof).to.be.null;
        await agentBot.handleDailyTasks(orm.em);
        expect(agentBot.latestProof).to.be.null;
    });

    it("Should not handle corner cases - mock agent bot", async () => {
        const spyError = spy.on(console, "error");
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        const mockAgentBot = new MockAgentBot(agentBot.agent, agentBot.notifier);
        await mockAgentBot.handleCornerCases(orm.em);
        expect(spyError).to.be.called.once;
    });

    it("Should not handle claims - no contracts", async () => {
        const spyError = spy.on(console, "error");
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
        await agentBot.checkForClaims();
        expect(spyError).to.be.called.twice;
    });

    it("Should handle claims", async () => {
        const spyError = spy.on(console, "error");
        // create agent bot
        const agentBot = await createTestAgentBot(context, orm, ownerAddress);
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
        // check
        await agentBot.checkForClaims();
        // mock functions - there is nothing to claim
        const getEpochs2 = web3.eth.abi.encodeFunctionCall(
            { type: "function", name: "getEpochsWithUnclaimedRewards", inputs: [{ name: "_beneficiary", type: "address" }] },
            [agentBot.agent.collateralPool.address]
        );
        const epochs2 = web3.eth.abi.encodeParameter("uint256[]", []);
        await mockContractFtsoManager.givenMethodReturn(getEpochs2, epochs2);
        // check
        await agentBot.checkForClaims();
        expect(spyError).to.be.called.exactly(0);
        // clean up
        await agentBot.context.addressUpdater.removeContracts(["FtsoRewardManager"]);
        await agentBot.context.addressUpdater.removeContracts(["DistributionToDelegators"]);
    });

    it("Should increment pool token suffix", async () => {
        const token = "poolTokenSuffix";
        expect(Agent.incrementPoolTokenSuffix(token, 0)).to.eq(token);
    });
});
