import { time } from "@openzeppelin/test-helpers";
import { AgentStatus } from "../../../src/actors/AgentBot";
import { AgentB } from "../../../src/fasset-bots/AgentB";
import { Minter } from "../../../src/mock/Minter";
import { MockChain } from "../../../src/mock/MockChain";
import { TrackedState } from "../../../src/state/TrackedState";
import { EventArgs } from "../../../src/utils/events/common";
import { checkedCast, QUERY_WINDOW_SECONDS, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { AgentCreated, AgentDestroyed } from "../../../typechain-truffle/AssetManager";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";
import { convertLotsToUBA, convertAmgToUBA } from "../../../src/fasset/Conversions";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

const agentDestroyedArgs = {
    '0': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    __length__: 1,
    agentVault: '0x094f7F426E4729d967216C2468DD1d44E2396e3d'
} as EventArgs<AgentDestroyed>;

const agentCreatedArgs = {
    '0': '0xedCdC766aA7DbB84004428ee0d35075375270E9B',
    '1': toBN(0),
    '2': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    '3': 'UNDERLYING_ACCOUNT_78988',
    __length__: 4,
    owner: '0xedCdC766aA7DbB84004428ee0d35075375270E9B',
    agentType: toBN(0),
    agentVault: '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    underlyingAddress: 'UNDERLYING_ACCOUNT_78988'
} as EventArgs<AgentCreated>;

const deposit = toBNExp(1_000_000, 18);
const underlyingAddress: string = "UNDERLYING_ADDRESS";

describe("Tracked state tests", async () => {
    let context: TestAssetBotContext;
    let accounts: string[];
    let agentB: AgentB;
    let minter: Minter;
    let ownerAddress: string;
    let minterAddress: string;
    let chain: MockChain;
    let trackedState: TrackedState;
    let governance: string;

    async function createTestActors(ownerAddress: string, minterAddress: string, minterUnderlying: string = "MINTER_ADDRESS"): Promise<void> {
        agentB = await AgentB.create(context, ownerAddress, underlyingAddress);
        await agentB.depositCollateral(deposit);
        await agentB.makeAvailable(500, 3_0000);
        minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(100_000, 18));
        chain.mine(chain.finalizationBlocks + 1);
    }

    async function createCRAndPerformMinting(minter: Minter, agentB: AgentB, lots: number) {
        const crt = await minter.reserveCollateral(agentB.vaultAddress, lots);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        return await minter.executeMinting(crt, txHash0);
    }

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        governance = accounts[0];
    });

    beforeEach(async () => {
        context = await createTestAssetContext(governance, testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        const lastBlock = await web3.eth.getBlockNumber();
        trackedState = new TrackedState(context, lastBlock);
        await trackedState.initialize();
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
    });

    it("Should create agent", async () => {
        trackedState.createAgent(agentCreatedArgs.agentVault, agentCreatedArgs.owner, agentCreatedArgs.underlyingAddress);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should create agent with current state", async () => {
        const agentBLocal = await AgentB.create(context, accounts[0], underlyingAddress);
        await trackedState.createAgentWithCurrentState(agentBLocal.vaultAddress);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should destroy agent", async () => {
        expect(trackedState.agents.size).to.eq(0);
        trackedState.destroyAgent(agentDestroyedArgs);
        expect(trackedState.agents.size).to.eq(0);
        trackedState.createAgent(agentCreatedArgs.agentVault, agentCreatedArgs.owner, agentCreatedArgs.underlyingAddress);
        expect(trackedState.agents.size).to.eq(1);
        trackedState.destroyAgent(agentDestroyedArgs);
        expect(trackedState.agents.size).to.eq(0);
    });

    it("Should get agent", async () => {
        trackedState.createAgent(agentCreatedArgs.agentVault, agentCreatedArgs.owner, agentCreatedArgs.underlyingAddress);
        const agent = trackedState.getAgent(agentCreatedArgs.agentVault);
        expect(agent!.vaultAddress).to.eq(agentCreatedArgs.agentVault);
        expect(agent!.ownerAddress).to.eq(agentCreatedArgs.owner);
        expect(agent!.underlyingAddress).to.eq(agentCreatedArgs.underlyingAddress);
        const agentUndefined = trackedState.getAgent("");
        expect(agentUndefined).to.be.undefined;
    });

    it("Should get agent and and add it if it does not exist", async () => {
        const agentBLocal = await AgentB.create(context, accounts[0], underlyingAddress);
        const agentUndefined = trackedState.getAgent(agentBLocal.vaultAddress);
        expect(agentUndefined).to.be.undefined;
        const agent = await trackedState.getAgentTriggerAdd(agentBLocal.vaultAddress);
        expect(agent!.vaultAddress).to.eq(agentBLocal.vaultAddress);
        expect(agent!.ownerAddress).to.eq(agentBLocal.ownerAddress);
        expect(agent!.underlyingAddress).to.eq(agentBLocal.underlyingAddress);
        const agentAgain = await trackedState.getAgentTriggerAdd(agentBLocal.vaultAddress);
        expect(agentAgain!.vaultAddress).to.eq(agentBLocal.vaultAddress);
        expect(agentAgain!.ownerAddress).to.eq(agentBLocal.ownerAddress);
        expect(agentAgain!.underlyingAddress).to.eq(agentBLocal.underlyingAddress);
    });

    it("Should handle event 'PriceEpochFinalized'", async () => {
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        const spy = chai.spy.on(trackedState, 'getPrices');
        await trackedState.readUnhandledEvents()
        expect(spy).to.have.been.called.once;
    });

    it("Should handle event 'AgentCreated'", async () => {
        await AgentB.create(context, accounts[0], underlyingAddress);
        expect(trackedState.agents.size).to.eq(0);
        await trackedState.readUnhandledEvents();
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should handle event 'AgentAvailable'", async () => {
        const agentBLocal = await AgentB.create(context, accounts[0], underlyingAddress);
        await agentBLocal.depositCollateral(deposit);
        await agentBLocal.makeAvailable(500, 25000);
        const agentBefore = trackedState.createAgent(agentBLocal.vaultAddress, agentBLocal.ownerAddress, agentBLocal.underlyingAddress);
        expect(agentBefore.publiclyAvailable).to.be.false;
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentBLocal.vaultAddress)!;
        expect(agentAfter.publiclyAvailable).to.be.true;
    });

    it("Should handle event 'AvailableAgentExited'", async () => {
        const agentBLocal = await AgentB.create(context, accounts[0], underlyingAddress);
        await agentBLocal.depositCollateral(deposit);
        await agentBLocal.makeAvailable(500, 25000);
        const agentBefore = trackedState.createAgent(agentBLocal.vaultAddress, agentBLocal.ownerAddress, agentBLocal.underlyingAddress);
        expect(agentBefore.publiclyAvailable).to.be.false;
        await trackedState.readUnhandledEvents();
        const agentMiddle = trackedState.getAgent(agentBLocal.vaultAddress)!;
        expect(agentMiddle.publiclyAvailable).to.be.true;
        await agentBLocal.exitAvailable();
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentBLocal.vaultAddress)!;
        expect(agentAfter.publiclyAvailable).to.be.false;
    });

    it("Should handle event 'AgentDestroyed'", async () => {
        const agentBLocal = await AgentB.create(context, accounts[0], underlyingAddress);
        await agentBLocal.depositCollateral(deposit);
        await agentBLocal.announceDestroy();
        await trackedState.readUnhandledEvents();
        const agentBefore = trackedState.getAgent(agentBLocal.vaultAddress);
        expect(agentBefore?.status).to.eq(AgentStatus.DESTROYING);
        await time.increase(300);
        await agentBLocal.destroy();
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentBLocal.vaultAddress);
        expect(agentAfter).to.be.undefined;
    });

    it("Should handle event 'SelfClose'", async () => {
        const agentBLocal = await AgentB.create(context, ownerAddress, underlyingAddress);
        await agentBLocal.depositCollateral(deposit);
        await agentBLocal.makeAvailable(500, 25000);
        const lots = 3;
        const supplyBefore = trackedState.fAssetSupply;
        const randomUnderlyingAddress = "RANDOM_UNDERLYING";
        context.chain.mint(randomUnderlyingAddress, toBNExp(10_000, 6));
        const amountUBA = convertLotsToUBA(await context.assetManager.getSettings(), lots);
        const selfMint = await agentBLocal.selfMint(randomUnderlyingAddress, amountUBA, lots);
        await trackedState.readUnhandledEvents();
        const supplyMiddle = trackedState.fAssetSupply;
        expect(selfMint.mintedAmountUBA.toString()).to.eq(amountUBA.toString());
        await agentBLocal.selfClose(selfMint.mintedAmountUBA);
        await trackedState.readUnhandledEvents();
        const supplyAfter = trackedState.fAssetSupply;
        expect(supplyMiddle.gt(supplyBefore)).to.be.true;
        expect(supplyAfter.lt(supplyMiddle)).to.be.true;
    });

    it("Should handle event 'CollateralReserved'", async () => {
        await createTestActors(ownerAddress, minterAddress);
        await minter.reserveCollateral(agentB.vaultAddress, 2);
        const agentBefore = trackedState.createAgent(agentB.vaultAddress, agentB.ownerAddress, agentB.underlyingAddress);
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentB.vaultAddress)!;
        expect(agentAfter.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
    });

    it("Should handle events 'MintingExecuted' and 'Transfer'", async () => {
        await createTestActors(ownerAddress, minterAddress);
        await createCRAndPerformMinting(minter, agentB, 2);
        const agentBefore = trackedState.createAgent(agentB.vaultAddress, agentB.ownerAddress, agentB.underlyingAddress);
        const supplyBefore = trackedState.fAssetSupply;
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentB.vaultAddress)!;
        const supplyAfter = trackedState.fAssetSupply;
        expect(agentAfter.freeUnderlyingBalanceUBA.gt(agentBefore.freeUnderlyingBalanceUBA)).to.be.true;
        expect(agentAfter.mintedUBA.gt(agentBefore.mintedUBA)).to.be.true;
        expect(supplyAfter.gt(supplyBefore)).to.be.true;
        expect(agentAfter.totalCollateralNATWei.gt(agentBefore.totalCollateralNATWei)).to.be.true;
    });

    it("Should handle event 'MintingPaymentDefault'", async () => {
        await createTestActors(ownerAddress, minterAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const lots = 2;
        const crt = await minter.reserveCollateral(agentB.vaultAddress, lots);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp))
        chain.mine(Number(crt.lastUnderlyingBlock))
        await trackedState.readUnhandledEvents();
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        await agentB.mintingPaymentDefault(crt);
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(agentMiddle.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
        expect(agentMiddle.reservedUBA.gt(agentAfter.reservedUBA)).to.be.true;
    });

    it("Should handle event 'CollateralReservationDeleted'", async () => {
        await createTestActors(ownerAddress, minterAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const lots = 2;
        const crt = await minter.reserveCollateral(agentB.vaultAddress, lots);
        await trackedState.readUnhandledEvents();
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        await agentB.unstickMinting(crt);
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(agentMiddle.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
        expect(agentMiddle.reservedUBA.gt(agentAfter.reservedUBA)).to.be.true;
    });

    it("Should handle events 'UnderlyingWithdrawalAnnounced' and 'UnderlyingWithdrawalCancelled'", async () => {
        const agentBLocal = await AgentB.create(context, ownerAddress, underlyingAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentBLocal.vaultAddress));
        const resAnnounce = await agentBLocal.announceUnderlyingWithdrawal();
        await trackedState.readUnhandledEvents();
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentBLocal.vaultAddress));
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        await agentBLocal.cancelUnderlyingWithdrawal(resAnnounce);
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentBLocal.vaultAddress));
        expect(agentBefore.announcedUnderlyingWithdrawalId.eq(toBN(0))).to.be.true;
        expect(agentMiddle.announcedUnderlyingWithdrawalId.gt(toBN(0))).to.be.true;
        expect(agentAfter.announcedUnderlyingWithdrawalId.eq(toBN(0))).to.be.true;
    });

    it("Should handle event 'DustChanged'", async () => {
        await createTestActors(ownerAddress, minterAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const lots = 3;
        const minted = await createCRAndPerformMinting(minter, agentB, lots);
        await trackedState.readUnhandledEvents();
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        await context.fAsset.transfer(agentB.ownerAddress, minted.mintedAmountUBA, { from: minter.address });
        const dustAmountUBA = convertAmgToUBA(await context.assetManager.getSettings(), 5);
        const selfCloseAmountUBA = minted.mintedAmountUBA.sub(dustAmountUBA);
        await agentB.selfClose(selfCloseAmountUBA);
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(agentBefore.dustUBA.eq(toBN(0))).to.be.true;
        expect(agentMiddle.dustUBA.eq(toBN(0))).to.be.true;
        expect(agentAfter.dustUBA.gt(toBN(0))).to.be.true;
    });

    it("Should not register event - error", async () => {
        const spy = chai.spy.on(console, 'error');
        const currentSettings = await context.assetManager.getSettings();
        await context.assetManagerController.setLotSizeAmg([context.assetManager.address], toBN(currentSettings.lotSizeAMG).divn(4), { from: governance });
        await trackedState.readUnhandledEvents();
        expect(spy).to.have.been.called.once;
    });

    it("Should handle event 'LiquidationPerformed'", async () => {
        await createTestActors(ownerAddress, minterAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const minted = await createCRAndPerformMinting(minter, agentB, 3);
        const supplyBefore = trackedState.fAssetSupply;
        await trackedState.readUnhandledEvents();
        const lots = 3;
        const liquidatorAddress = accounts[100];
        // price change
        await context.natFtso.setCurrentPrice(1, 0);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 6), 0);
        // liquidator "buys" f-assets
        await context.fAsset.transfer(liquidatorAddress, minted.mintedAmountUBA, { from: minter.address });
        // liquidate agent (partially)
        const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
        await context.assetManager.liquidate(agentB.agentVault.address, liquidateMaxUBA, { from: liquidatorAddress });
        const supplyMiddle = trackedState.fAssetSupply;
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        await trackedState.readUnhandledEvents();
        const supplyAfter = trackedState.fAssetSupply;
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(supplyBefore.lt(supplyMiddle)).to.be.true;
        expect(supplyAfter.lt(supplyMiddle)).to.be.true;
        expect(agentBefore.freeUnderlyingBalanceUBA.lt(agentMiddle.freeUnderlyingBalanceUBA)).to.be.true;
        expect(agentMiddle.freeUnderlyingBalanceUBA.lt(agentAfter.freeUnderlyingBalanceUBA)).to.be.true;
        expect(agentBefore.mintedUBA.lt(agentMiddle.mintedUBA)).to.be.true;
        expect(agentMiddle.mintedUBA.gt(agentAfter.mintedUBA)).to.be.true;
    });

});