import { time } from "@openzeppelin/test-helpers";
import { expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { AgentStatus } from "../../../src/fasset/AssetManagerTypes";
import { lotSize } from "../../../src/fasset/Conversions";
import { PaymentReference } from "../../../src/fasset/PaymentReference";
import { MockChain } from "../../../src/mock/MockChain";
import { tokenBalance } from "../../../src/state/TokenPrice";
import { MAX_EVENT_HANDLE_RETRY, TrackedState } from "../../../src/state/TrackedState";
import { EventArgs } from "../../../src/utils/events/common";
import { requiredEventArgs } from "../../../src/utils/events/truffle";
import { attestationWindowSeconds } from "../../../src/utils/fasset-helpers";
import { BN_ZERO, MAX_BIPS, QUERY_WINDOW_SECONDS, ZERO_ADDRESS, checkedCast, toBN, toBNExp } from "../../../src/utils/helpers";
import { artifacts, web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { performRedemptionPayment } from "../../../test/test-utils/test-helpers";
import { AgentDestroyed, AgentVaultCreated } from "../../../typechain-truffle/IIAssetManager";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext, getTestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { createCRAndPerformMinting, createTestAgent, createTestAgentAndMakeAvailable, createTestMinter, createTestRedeemer, fromAgentInfoToInitialAgentData, mintAndDepositVaultCollateralToOwner } from "../../test-utils/helpers";
import { waitForTimelock } from "../../test-utils/new-asset-manager";
use(chaiAsPromised);
use(spies);

const ERC20Mock = artifacts.require("ERC20Mock");
const FakeERC20 = artifacts.require("FakeERC20");

const agentDestroyedArgs = {
    "0": "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
    __length__: 1,
    agentVault: "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
} as EventArgs<AgentDestroyed>;
const agentCreatedArgs = {
    "0": "0xedCdC766aA7DbB84004428ee0d35075375270E9B",
    "1": "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
    "2": "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
    "3": "UNDERLYING_ACCOUNT_78988",
    "4": "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
    "5": toBN(0),
    "6": toBN(0),
    "7": toBN(0),
    "8": toBN(0),
    "9": toBN(0),
    "10": toBN(0),
    "11": toBN(0),
    "12": toBN(0),
    __length__: 13,
    owner: "0xedCdC766aA7DbB84004428ee0d35075375270E9B",
    agentVault: "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
    collateralPool: "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
    underlyingAddress: "UNDERLYING_ACCOUNT_78988",
    vaultCollateralToken: "0x094f7F426E4729d967216C2468DD1d44E2396e3d",
    feeBIPS: toBN(0),
    poolFeeShareBIPS: toBN(0),
    mintingVaultCollateralRatioBIPS: toBN(0),
    mintingPoolCollateralRatioBIPS: toBN(0),
    buyFAssetByAgentFactorBIPS: toBN(0),
    poolExitCollateralRatioBIPS: toBN(0),
    poolTopupCollateralRatioBIPS: toBN(0),
    poolTopupTokenPriceFactorBIPS: toBN(0),
} as EventArgs<AgentVaultCreated>;

const depositUSDC = toBNExp(1_000_000, 6);
const depositWei = toBNExp(1_000_000, 18);

describe("Tracked state tests", () => {
    let context: TestAssetBotContext;
    let trackedStateContext: TestAssetTrackedStateContext;
    let accounts: string[];
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;
    let trackedState: TrackedState;
    let governance: string;
    let updateExecutor: string;
    let assetManagerControllerAddress: string;

    async function createContextAndInitializeTrackedState(assetManagerControllerAddress?: string): Promise<void> {
        context = await createTestAssetContext(governance, testChainInfo.xrp, { updateExecutor, assetManagerControllerAddress });
        trackedStateContext = getTestAssetTrackedStateContext(context);
        chain = checkedCast(trackedStateContext.blockchainIndexer.chain, MockChain);
        const lastBlock = await web3.eth.getBlockNumber();
        trackedState = new TrackedState(trackedStateContext, lastBlock);
        await trackedState.initialize();
    }

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
        governance = accounts[0];
        updateExecutor = accounts[11];
        assetManagerControllerAddress = accounts[301];
    });

    async function initialize() {
        await createContextAndInitializeTrackedState();
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        return { context, trackedStateContext, chain, trackedState };
    }

    beforeEach(async () => {
        ({ context, trackedStateContext, chain, trackedState } = await loadFixtureCopyVars(initialize));
    });

    afterEach(async () => {
        spy.restore(console);
    });

    it("Should create agent", async () => {
        trackedState.createAgent(agentCreatedArgs);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should create agent with current state", async () => {
        const agentBLocal = await createTestAgent(context, accounts[0]);
        await trackedState.createAgentWithCurrentState(agentBLocal.vaultAddress);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should destroy agent", async () => {
        expect(trackedState.agents.size).to.eq(0);
        trackedState.destroyAgent(agentDestroyedArgs);
        expect(trackedState.agents.size).to.eq(0);
        trackedState.createAgent(agentCreatedArgs);
        expect(trackedState.agents.size).to.eq(1);
        trackedState.destroyAgent(agentDestroyedArgs);
        expect(trackedState.agents.size).to.eq(0);
    });

    it("Should get agent", async () => {
        trackedState.createAgent(agentCreatedArgs);
        const agent = trackedState.getAgent(agentCreatedArgs.agentVault);
        expect(agent!.vaultAddress).to.eq(agentCreatedArgs.agentVault);
        expect(agent!.underlyingAddress).to.eq(agentCreatedArgs.underlyingAddress);
        const agentUndefined = trackedState.getAgent("");
        expect(agentUndefined).to.be.undefined;
    });

    it("Should get agent and add it if it does not exist", async () => {
        const agentBLocal = await createTestAgent(context, accounts[0]);
        const agentUndefined = trackedState.getAgent(agentBLocal.vaultAddress);
        expect(agentUndefined).to.be.undefined;
        const agent = await trackedState.getAgentTriggerAdd(agentBLocal.vaultAddress);
        expect(agent!.vaultAddress).to.eq(agentBLocal.vaultAddress);
        expect(agent!.underlyingAddress).to.eq(agentBLocal.underlyingAddress);
        const agentAgain = await trackedState.getAgentTriggerAdd(agentBLocal.vaultAddress);
        expect(agentAgain!.vaultAddress).to.eq(agentBLocal.vaultAddress);
        expect(agentAgain!.underlyingAddress).to.eq(agentBLocal.underlyingAddress);
    });

    it("Should handle event 'PriceEpochFinalized'", async () => {
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        const spyPrices = spy.on(trackedState, "getPrices");
        await trackedState.readUnhandledEvents();
        expect(spyPrices).to.have.been.called.once;
    });

    it("Should handle event 'AgentVaultCreated'", async () => {
        await createTestAgent(context, accounts[0]);
        expect(trackedState.agents.size).to.eq(0);
        await trackedState.readUnhandledEvents();
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should handle event 'AgentAvailable'", async () => {
        const ownerLocal = accounts[0];
        const agentBLocal = await createTestAgent(context, ownerLocal);
        await mintAndDepositVaultCollateralToOwner(context, agentBLocal, depositUSDC, ownerLocal);
        await agentBLocal.depositVaultCollateral(depositUSDC);
        await agentBLocal.buyCollateralPoolTokens(depositWei);
        await agentBLocal.makeAvailable();
        const agentBefore = trackedState.createAgent(await fromAgentInfoToInitialAgentData(agentBLocal));
        expect(agentBefore.publiclyAvailable).to.be.false;
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentBLocal.vaultAddress)!;
        expect(agentAfter.publiclyAvailable).to.be.true;
    });

    it("Should handle event 'AvailableAgentExited'", async () => {
        const ownerLocal = accounts[0];
        const agentBLocal = await createTestAgent(context, ownerLocal);
        await mintAndDepositVaultCollateralToOwner(context, agentBLocal, depositUSDC, ownerLocal);
        await agentBLocal.depositVaultCollateral(depositUSDC);
        await agentBLocal.buyCollateralPoolTokens(depositWei);
        await agentBLocal.makeAvailable();
        const agentBefore = trackedState.createAgent(await fromAgentInfoToInitialAgentData(agentBLocal));
        expect(agentBefore.publiclyAvailable).to.be.false;
        await trackedState.readUnhandledEvents();
        const agentMiddle = trackedState.getAgent(agentBLocal.vaultAddress)!;
        expect(agentMiddle.publiclyAvailable).to.be.true;
        const exitAvailableAt = await agentBLocal.announceExitAvailable();
        await time.increaseTo(exitAvailableAt);
        await agentBLocal.exitAvailable();
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentBLocal.vaultAddress)!;
        expect(agentAfter.publiclyAvailable).to.be.false;
    });

    it("Should handle event 'AgentDestroyed'", async () => {
        const ownerLocal = accounts[0];
        const agentBLocal = await createTestAgent(context, ownerLocal);
        await mintAndDepositVaultCollateralToOwner(context, agentBLocal, depositUSDC, ownerLocal);
        await agentBLocal.depositVaultCollateral(depositUSDC);
        await agentBLocal.announceDestroy();
        await trackedState.readUnhandledEvents();
        const agentBefore = trackedState.getAgent(agentBLocal.vaultAddress);
        expect(agentBefore?.status).to.eq(AgentStatus.DESTROYING);
        const settings = await context.assetManager.getSettings();
        await time.increase(settings.withdrawalWaitMinSeconds);
        await agentBLocal.destroy();
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentBLocal.vaultAddress);
        expect(agentAfter).to.be.undefined;
    });

    it("Should handle event 'SelfClose'", async () => {
        const agentBLocal = await createTestAgent(context, ownerAddress);
        await mintAndDepositVaultCollateralToOwner(context, agentBLocal, depositUSDC, ownerAddress);
        await agentBLocal.depositVaultCollateral(depositUSDC);
        await agentBLocal.buyCollateralPoolTokens(depositWei);
        await agentBLocal.makeAvailable();
        const lots = 3;
        const supplyBefore = trackedState.fAssetSupply;
        // convert lots in uba
        const amountUBA = toBN(lots).mul(lotSize(await context.assetManager.getSettings()));
        const agentSettings = await agentBLocal.getAgentSettings();
        const poolFee = amountUBA.mul(toBN(agentSettings.feeBIPS)).mul(toBN(agentSettings.poolFeeShareBIPS));

        const randomUnderlyingAddress = "RANDOM_UNDERLYING";
        const allAmountUBA = amountUBA.add(poolFee);
        context.blockchainIndexer.chain.mint(randomUnderlyingAddress, allAmountUBA);

        const transactionHash = await agentBLocal.wallet.addTransaction(
            randomUnderlyingAddress,
            agentBLocal.underlyingAddress,
            allAmountUBA,
            PaymentReference.selfMint(agentBLocal.agentVault.address)
        );
        const proof = await agentBLocal.attestationProvider.provePayment(transactionHash, null, agentBLocal.underlyingAddress);
        const res = await agentBLocal.assetManager.selfMint(proof, agentBLocal.agentVault.address, lots, { from: agentBLocal.owner.workAddress });
        const selfMint = requiredEventArgs(res, "MintingExecuted");

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
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await minter.reserveCollateral(agentB.vaultAddress, 2);
        const agentBefore = Object.assign({}, trackedState.createAgent(await fromAgentInfoToInitialAgentData(agentB)));
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress)!);
        expect(agentAfter.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
    });

    it("Should handle event 'MintingExecuted'", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await createCRAndPerformMinting(minter, agentB.vaultAddress, 2, chain);
        const agentBefore = Object.assign({}, trackedState.createAgent(await fromAgentInfoToInitialAgentData(agentB)));
        const supplyBefore = trackedState.fAssetSupply;
        const freeUnderlyingBalanceUBABefore = trackedState.agents.get(agentB.vaultAddress)!.freeUnderlyingBalanceUBA;
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress)!);
        const supplyAfter = trackedState.fAssetSupply;
        const freeUnderlyingBalanceUBAAfter = trackedState.agents.get(agentB.vaultAddress)!.freeUnderlyingBalanceUBA;
        expect(freeUnderlyingBalanceUBAAfter.gt(freeUnderlyingBalanceUBABefore)).to.be.true;
        expect(agentAfter.mintedUBA.gt(agentBefore.mintedUBA)).to.be.true;
        expect(supplyAfter.gt(supplyBefore)).to.be.true;
    });

    it("Should handle event 'MintingPaymentDefault'", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const lots = 2;
        const crt = await minter.reserveCollateral(agentB.vaultAddress, lots);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp));
        chain.mine(Number(crt.lastUnderlyingBlock));
        await trackedState.readUnhandledEvents();
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        const proof = await agentB.attestationProvider.proveReferencedPaymentNonexistence(
            agentB.underlyingAddress,
            crt.paymentReference,
            crt.valueUBA.add(crt.feeUBA),
            crt.firstUnderlyingBlock.toNumber(),
            crt.lastUnderlyingBlock.toNumber(),
            crt.lastUnderlyingTimestamp.toNumber()
        );
        await agentB.assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: agentB.owner.workAddress });
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(agentMiddle.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
        expect(agentMiddle.reservedUBA.gt(agentAfter.reservedUBA)).to.be.true;
    });

    it("Should handle event 'RedemptionRequested' from collateral pool self close exit", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const minter = await createTestMinter(context, minterAddress, chain);
        // minter enters pool
        await agentB.collateralPool.enter(0, false, { value: toBNExp(100_000, 18), from: minter.address });
        // tweak some pool settings
        const validAtFee = await agentB.announceAgentSettingUpdate("poolFeeShareBIPS", 9999);
        await time.increaseTo(validAtFee);
        await agentB.executeAgentSettingUpdate("poolFeeShareBIPS");
        const curr = toBN((await agentB.getAgentSettings()).poolExitCollateralRatioBIPS);
        const validAtExit = await agentB.announceAgentSettingUpdate("poolExitCollateralRatioBIPS", curr.muln(3).divn(2));
        await time.increaseTo(validAtExit);
        await agentB.executeAgentSettingUpdate("poolExitCollateralRatioBIPS");
        // minter performs minting
        const lots = 20;
        await createCRAndPerformMinting(minter, agentB.vaultAddress, lots, chain);
        // increase fAsset allowance
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.approve(agentB.collateralPool.address, fBalance, { from: minter.address });
        // self close exit
        const tokensMinter = await agentB.collateralPoolToken.balanceOf(minter.address);
        await agentB.collateralPool.selfCloseExit(tokensMinter, false, minter.underlyingAddress, ZERO_ADDRESS, { from: minter.address });
        // handle events
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        expect(agentAfter.poolRedeemingUBA.eq(agentBefore.poolRedeemingUBA)).to.be.true;
    });

    it("Should handle event 'RedeemedInCollateral' from collateral pool self close exit", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const minter = await createTestMinter(context, minterAddress, chain);
        // minter enters pool
        await agentB.collateralPool.enter(0, false, { value: toBNExp(100_000, 18), from: minter.address });
        // tweak some pool settings
        const validAt1 = await agentB.announceAgentSettingUpdate("poolFeeShareBIPS", 9999);
        await time.increaseTo(validAt1);
        await agentB.executeAgentSettingUpdate("poolFeeShareBIPS");
        const validAt2 = await agentB.announceAgentSettingUpdate("poolExitCollateralRatioBIPS", 27000);
        await time.increaseTo(validAt2);
        await agentB.executeAgentSettingUpdate("poolExitCollateralRatioBIPS");
        // minter performs minting
        const lots = 33;
        await createCRAndPerformMinting(minter, agentB.vaultAddress, lots, chain);
        // increase fAsset allowance
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.approve(agentB.collateralPool.address, fBalance, { from: minter.address });
        // self close exit
        const tokensMinter = await agentB.collateralPoolToken.balanceOf(minter.address);
        await agentB.collateralPool.selfCloseExit(tokensMinter, true, minter.underlyingAddress, ZERO_ADDRESS, { from: minter.address });
        // handle events
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        expect(agentAfter.poolRedeemingUBA.eq(agentBefore.poolRedeemingUBA)).to.be.true;
    });

    it("Should handle event 'RedemptionPerformed'", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await trackedState.readUnhandledEvents();
        const lots = 2;
        await createCRAndPerformMinting(minter, agentB.vaultAddress, lots, chain);
        const spyRedemption = spy.on(trackedState.getAgent(agentB.vaultAddress)!, "handleRedemptionPerformed");
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const tx1Hash = await performRedemptionPayment(agentB, rdReqs[0]);
        const proof = await agentB.attestationProvider.provePayment(tx1Hash, agentB.underlyingAddress, rdReqs[0].paymentAddress);
        await agentB.assetManager.confirmRedemptionPayment(proof, rdReqs[0].requestId, { from: agentB.owner.workAddress });
        await trackedState.readUnhandledEvents();
        expect(spyRedemption).to.have.been.called.once;
    });

    it("Should handle event 'CollateralReservationDeleted'", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const lots = 2;
        const crt = await minter.reserveCollateral(agentB.vaultAddress, lots);
        await trackedState.readUnhandledEvents();
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        const settings = await context.assetManager.getSettings();
        const burnNats = (await agentB.getPoolCollateralPrice())
            .convertUBAToTokenWei(crt.valueUBA)
            .mul(toBN(settings.vaultCollateralBuyForFlareFactorBIPS))
            .divn(MAX_BIPS);
        const proof = await agentB.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(context.assetManager));
        await agentB.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: agentB.owner.workAddress, value: burnNats ?? BN_ZERO });
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(agentMiddle.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
        expect(agentMiddle.reservedUBA.gt(agentAfter.reservedUBA)).to.be.true;
    });

    it("Should handle events 'UnderlyingWithdrawalAnnounced' and 'UnderlyingWithdrawalCancelled'", async () => {
        const agentBLocal = await createTestAgent(context, ownerAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentBLocal.vaultAddress));
        await agentBLocal.announceUnderlyingWithdrawal();
        await trackedState.readUnhandledEvents();
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentBLocal.vaultAddress));
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        await agentBLocal.cancelUnderlyingWithdrawal();
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentBLocal.vaultAddress));
        expect(agentBefore.announcedUnderlyingWithdrawalId.eq(toBN(0))).to.be.true;
        expect(agentMiddle.announcedUnderlyingWithdrawalId.gt(toBN(0))).to.be.true;
        expect(agentAfter.announcedUnderlyingWithdrawalId.eq(toBN(0))).to.be.true;
    });

    it("Should handle event 'UnderlyingBalanceToppedUp", async () => {
        const agentBLocal = await createTestAgent(context, ownerAddress);
        await agentBLocal.announceUnderlyingWithdrawal();
        await trackedState.readUnhandledEvents();
        const agentBefore = trackedState.agents.get(agentBLocal.vaultAddress);
        expect(agentBefore?.underlyingBalanceUBA.eqn(0));
        const skipTime = (await context.assetManager.getSettings()).announcedUnderlyingConfirmationMinSeconds;
        await time.increase(skipTime);
        const underlyingAddress: string = "RANDOM_UNDERLYING_ADDRESS";
        const deposit = toBN(200);
        chain.mint(underlyingAddress, deposit);
        const tx = await agentBLocal.performTopupPayment(deposit, underlyingAddress);
        chain.mine(chain.finalizationBlocks + 1);
        await agentBLocal.confirmTopupPayment(tx);
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.agents.get(agentBLocal.vaultAddress);
        expect(agentAfter?.underlyingBalanceUBA.eq(deposit));
    });

    it("Should handle event 'DustChanged'", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const lots = 3;
        await createCRAndPerformMinting(minter, agentB.vaultAddress, lots, chain);
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        expect(agentBefore.dustUBA.eq(toBN(0))).to.be.true;
        expect(agentAfter.dustUBA.gt(toBN(0))).to.be.true;
    });

    it("Should handle event 'LiquidationPerformed'", async () => {
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const minted = await createCRAndPerformMinting(minter, agentB.vaultAddress, 3, chain);
        const supplyBefore = trackedState.fAssetSupply;
        const freeUnderlyingBalanceUBABefore = trackedState.agents.get(agentB.vaultAddress)!.freeUnderlyingBalanceUBA;
        await trackedState.readUnhandledEvents();
        const lots = 3;
        const liquidatorAddress = accounts[100];
        await context.assetFtso.setCurrentPrice(toBNExp(10, 40), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 40), 0);
        // liquidator "buys" f-assets
        await context.fAsset.transfer(liquidatorAddress, minted.mintedAmountUBA, { from: minter.address });
        // liquidate agent (partially)
        const liquidateMaxUBA = minted.mintedAmountUBA.divn(lots);
        await context.assetManager.liquidate(agentB.agentVault.address, liquidateMaxUBA, { from: liquidatorAddress });
        const supplyMiddle = trackedState.fAssetSupply;
        const agentMiddle = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        const freeUnderlyingBalanceUBAMiddle = trackedState.agents.get(agentB.vaultAddress)!.freeUnderlyingBalanceUBA;
        await trackedState.readUnhandledEvents();
        const supplyAfter = trackedState.fAssetSupply;
        const freeUnderlyingBalanceUBAAfter = trackedState.agents.get(agentB.vaultAddress)!.freeUnderlyingBalanceUBA;
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(supplyBefore.lt(supplyMiddle)).to.be.true;
        expect(supplyAfter.lt(supplyMiddle)).to.be.true;
        expect(freeUnderlyingBalanceUBABefore.lt(freeUnderlyingBalanceUBAMiddle)).to.be.true;
        expect(freeUnderlyingBalanceUBAMiddle.lt(freeUnderlyingBalanceUBAAfter)).to.be.true;
        expect(agentBefore.mintedUBA.lt(agentMiddle.mintedUBA)).to.be.true;
        expect(agentMiddle.mintedUBA.gt(agentAfter.mintedUBA)).to.be.true;
    });

    it("Should handle event 'SettingChanged'", async () => {
        const paymentChallengeRewardUSD5_new = toBN(trackedState.settings.paymentChallengeRewardUSD5).muln(4);
        const paymentChallengeRewardBIPS_new = toBN(trackedState.settings.paymentChallengeRewardBIPS).muln(4).addn(100);
        await context.assetManagerController.setPaymentChallengeReward(
            [context.assetManager.address],
            paymentChallengeRewardUSD5_new,
            paymentChallengeRewardBIPS_new,
            { from: governance }
        );
        await trackedState.readUnhandledEvents();
        const settingsAfter = trackedState.settings;
        expect(settingsAfter.paymentChallengeRewardUSD5.toString()).to.eq(paymentChallengeRewardUSD5_new.toString());
        expect(settingsAfter.paymentChallengeRewardBIPS.toString()).to.eq(paymentChallengeRewardBIPS_new.toString());
    });

    it("Should handle event 'SettingArrayChanged'", async () => {
        const liquidationCollateralFactorBIPS = trackedState.settings.liquidationCollateralFactorBIPS.map(toBN);
        const liquidationFactorVaultCollateralBIPS = trackedState.settings.liquidationFactorVaultCollateralBIPS.map(toBN);
        const newLiquidationCollateralFactorBIPS = [2_0000, 2_5000];
        const newLiquidationFactorVaultCollateralBIPS = liquidationFactorVaultCollateralBIPS.slice(0, 2);
        const resp = await context.assetManagerController.setLiquidationPaymentFactors([context.assetManager.address],
            newLiquidationCollateralFactorBIPS, newLiquidationFactorVaultCollateralBIPS, { from: governance });
        await waitForTimelock(resp, context.assetManagerController, updateExecutor);
        await trackedState.readUnhandledEvents();
        const settingsAfter = trackedState.settings;
        expect(settingsAfter.liquidationCollateralFactorBIPS[0].toString()).to.eq(newLiquidationCollateralFactorBIPS[0].toString());
        expect(settingsAfter.liquidationCollateralFactorBIPS[1].toString()).to.eq(newLiquidationCollateralFactorBIPS[1].toString());
    });

    it("Should handle events 'SettingChanged' and 'SettingArrayChanged' - invalid setting", async () => {
        const spyError = spy.on(console, "error");
        const settingChangedEventFail = {
            address: trackedState.context.assetManager.address,
            type: "event",
            signature: "0xac1fb27759c1e6f9e4a24d4f8c320be6091becb03cea5a95398fa220fca4ac0e",
            event: "SettingChanged",
            args: {
                "0": "lotSizeAMGFail",
                "1": toBN(0),
                __length__: 2,
                name: "lotSizeAMGFail",
                value: toBN(0),
            },
            blockHash: "0xdc0640480d61a307ad0e7b67b8b7e3586bbd20aefa52620fb5b54f4a943a299d",
            blockNumber: 39,
            logIndex: 0,
            transactionHash: "0xf5081736c212077a16a512864ed480c60dfaf8f8d4d30bd452eec74125485cd5",
            transactionIndex: 0,
        };
        const settingArrayChangedEventFail = {
            address: trackedState.context.assetManager.address,
            type: "event",
            signature: "0xf8df5a8f8fc0ea5cc0d8aff70643ac14b7353b936a843e23cb08ff282ba74739",
            event: "SettingArrayChanged",
            args: {
                "0": "liquidationCollateralFactorBIPSFail",
                "1": [toBN(0), toBN(0)],
                __length__: 2,
                name: "liquidationCollateralFactorBIPSFail",
                value: [toBN(0), toBN(0)],
            },
            blockHash: "0xb80d1ac278eb17ad869bcd5c7be9bd6c907db6a03dabb69ec43b72e24aba141e",
            blockNumber: 39,
            logIndex: 0,
            transactionHash: "0x4878b678646979bfe49669034562c6a8f0ad1765910d1db9109fb8245097e7c4",
            transactionIndex: 0,
        };
        await trackedState.registerStateEvents([settingChangedEventFail]);
        await trackedState.registerStateEvents([settingArrayChangedEventFail]);
        expect(spyError).to.have.been.called.exactly(2 * (MAX_EVENT_HANDLE_RETRY + 1));
    });

    it("Should handle event 'AgentSettingChanged'", async () => {
        const agentBLocal = await createTestAgent(context, accounts[0]);
        await trackedState.createAgentWithCurrentState(agentBLocal.vaultAddress);
        const agentSettingsBefore = trackedState.agents.get(agentBLocal.vaultAddress)!.agentSettings;
        const agentBLocalSettingsBefore = await agentBLocal.getAgentSettings();
        expect(agentSettingsBefore.feeBIPS.toString()).to.eq(agentBLocalSettingsBefore.feeBIPS.toString());
        const feeBIPSNew = 1100;
        const allowedAt = await agentBLocal.announceAgentSettingUpdate("feeBIPS", feeBIPSNew);
        await time.increaseTo(allowedAt);
        await agentBLocal.executeAgentSettingUpdate("feeBIPS");
        await trackedState.readUnhandledEvents();
        const agentSettingsAfter = trackedState.agents.get(agentBLocal.vaultAddress)!.agentSettings;
        const agentBLocalSettingsAfter = await agentBLocal.getAgentSettings();
        expect(agentSettingsAfter.feeBIPS.toString()).to.eq(agentBLocalSettingsAfter.feeBIPS.toString());
        expect(agentSettingsAfter.feeBIPS.toString()).to.eq(feeBIPSNew.toString());
    });

    it("Should handle event 'Transfer'", async () => {
        const agentB = await createTestAgent(context, ownerAddress);
        const agentInfo = await agentB.getAgentInfo();
        await trackedState.createAgentWithCurrentState(agentB.vaultAddress);
        await mintAndDepositVaultCollateralToOwner(context, agentB, depositUSDC, ownerAddress);
        await agentB.depositVaultCollateral(depositUSDC.divn(2));
        await agentB.buyCollateralPoolTokens(depositWei);
        // deposit vault collateral one more time
        await agentB.depositVaultCollateral(depositUSDC.divn(2));
        await trackedState.readUnhandledEvents();
        await agentB.makeAvailable();
        await trackedState.readUnhandledEvents();
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalPoolCollateralNATWei.eq(depositWei)).to.be.true;
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalVaultCollateralWei[agentInfo.vaultCollateralToken].eq(depositUSDC)).to.be.true;
        // redeem pool
        const amount = await tokenBalance(context.wNat.address, agentInfo.collateralPool);
        const withdrawAllowedAt = await agentB.announcePoolTokenRedemption(amount);
        await time.increaseTo(withdrawAllowedAt);
        await agentB.redeemCollateralPoolTokens(amount);
        await trackedState.readUnhandledEvents();
        expect(amount.eq(depositWei)).to.be.true;
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalPoolCollateralNATWei.eqn(0)).to.be.true;
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalVaultCollateralWei[agentInfo.vaultCollateralToken].eq(depositUSDC)).to.be.true;
    });

    it("Should handle events 'CollateralTypeAdded', 'CollateralTypeDeprecated' and 'AgentCollateralTypeChanged", async () => {
        const collateralsBefore = trackedState.collaterals.list.length;
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        const agentVaultCollateral = await agentB.getVaultCollateral();
        const newCollateral = Object.assign({}, agentVaultCollateral);
        newCollateral.token = (await FakeERC20.new(accounts[0], "New Token", "NT", 6)).address;
        newCollateral.tokenFtsoSymbol = "XRP";
        newCollateral.assetFtsoSymbol = "testUSDC";
        await context.assetManagerController.addCollateralType([context.assetManager.address], newCollateral, { from: governance });
        await trackedState.readUnhandledEvents();
        const collateralsAfter = trackedState.collaterals.list.length;
        expect(collateralsAfter).to.eq(collateralsBefore + 1);
        await trackedState.readUnhandledEvents();
        const getCollateral0 = trackedState.collaterals.get(newCollateral.collateralClass, newCollateral.token);
        expect(toBN(getCollateral0.validUntil).eqn(0)).to.be.true;
        // deprecate
        const settings = await context.assetManager.getSettings();
        await context.assetManagerController.deprecateCollateralType(
            [context.assetManager.address],
            agentVaultCollateral.collateralClass,
            agentVaultCollateral.token,
            settings.tokenInvalidationTimeMinSeconds,
            { from: governance }
        );
        await trackedState.readUnhandledEvents();
        const getCollateral1 = trackedState.collaterals.get(agentVaultCollateral.collateralClass, agentVaultCollateral.token);
        expect(toBN(getCollateral1.validUntil).gtn(0)).to.be.true;
        // switch collateral
        await agentB.assetManager.switchVaultCollateral(agentB.vaultAddress, newCollateral.token, { from: agentB.owner.workAddress });
        await trackedState.readUnhandledEvents();
        expect(trackedState.agents.get(agentB.agentVault.address)?.agentSettings.vaultCollateralToken).to.eq(newCollateral.token);
    });

    it("Should handle event 'AgentCollateralTypeChanged'", async () => {
        await createContextAndInitializeTrackedState(assetManagerControllerAddress);
        const agentB = await createTestAgentAndMakeAvailable(context, ownerAddress);
        await trackedState.readUnhandledEvents();
        const spyCollateralChanged = spy.on(trackedState.getAgent(agentB.vaultAddress)!, "handleAgentCollateralTypeChanged");
        const newWnat = await ERC20Mock.new("Wrapped NAT", "WNAT");
        await context.assetManager.upgradeWNatContract(agentB.vaultAddress, { from: agentB.owner.workAddress });
        await trackedState.readUnhandledEvents();
        await context.assetManager.updateSettings(
            web3.utils.soliditySha3Raw(web3.utils.asciiToHex("updateContracts(address,IWNat)")),
            web3.eth.abi.encodeParameters(["address", "address"], [context.assetManagerController.address, newWnat.address]),
            { from: assetManagerControllerAddress }
        );
        await context.assetManager.upgradeWNatContract(agentB.vaultAddress, { from: agentB.owner.workAddress });
        await trackedState.readUnhandledEvents();
        expect(spyCollateralChanged).to.be.called.exactly(0);
    });

    it("Should handle event 'CollateralRatiosChanged'", async () => {
        console.log()
        const collateral = trackedState.collaterals.list[0];
        const newMinCollateralRatioBIPS = "23000";
        const newCcbMinCollateralRatioBIPS = "18000";
        const newSafetyMinCollateralRatioBIPS = "24000";
        expect(collateral.minCollateralRatioBIPS.toString()).to.not.eq(newMinCollateralRatioBIPS);
        expect(collateral.ccbMinCollateralRatioBIPS.toString()).to.not.eq(newCcbMinCollateralRatioBIPS);
        expect(collateral.safetyMinCollateralRatioBIPS.toString()).to.not.eq(newSafetyMinCollateralRatioBIPS);
        const resp = await context.assetManagerController.setCollateralRatiosForToken(
            [context.assetManager.address],
            collateral.collateralClass,
            collateral.token,
            newMinCollateralRatioBIPS,
            newCcbMinCollateralRatioBIPS,
            newSafetyMinCollateralRatioBIPS,
            { from: governance }
        );
        await waitForTimelock(resp, context.assetManagerController, updateExecutor);
        await trackedState.readUnhandledEvents();
        const getCollateral = trackedState.collaterals.list[0];
        expect(getCollateral.minCollateralRatioBIPS.toString()).to.eq(newMinCollateralRatioBIPS);
        expect(getCollateral.ccbMinCollateralRatioBIPS.toString()).to.eq(newCcbMinCollateralRatioBIPS);
        expect(getCollateral.safetyMinCollateralRatioBIPS.toString()).to.eq(newSafetyMinCollateralRatioBIPS);
    });

    it("Should fail at handling an event and revert to reinitializing the state", async () => {
        const spyError = spy.on(console, "error");
        const spyInit = spy.on(trackedState, "initialize");
        const settingChangedEventFail = {
            address: trackedState.context.assetManager.address,
            type: "event",
            signature: "0xac1fb27759c1e6f9e4a24d4f8c320be6091becb03cea5a95398fa220fca4ac0e",
            event: "SettingChanged",
            args: {
                "0": "lotSizeAMGFail",
                "1": toBN(0),
                __length__: 2,
                name: "lotSizeAMGFail",
                value: toBN(0),
            },
            blockHash: "0xdc0640480d61a307ad0e7b67b8b7e3586bbd20aefa52620fb5b54f4a943a299d",
            blockNumber: 39,
            logIndex: 0,
            transactionHash: "0xf5081736c212077a16a512864ed480c60dfaf8f8d4d30bd452eec74125485cd5",
            transactionIndex: 0,
        };
        await trackedState.registerStateEvents([settingChangedEventFail]);
        expect(spyError).to.have.been.called.exactly(MAX_EVENT_HANDLE_RETRY + 1);
        expect(spyInit).to.have.been.called.once;
    });

    it("Should return getTrackedStateAgentSettings", async () => {
        trackedState.createAgent(agentCreatedArgs);
        const agent = trackedState.getAgent(agentCreatedArgs.agentVault);
        const settings = agent?.getTrackedStateAgentSettings();
        expect(settings?.vaultAddress).to.eq(agentCreatedArgs.agentVault);
        expect(settings?.collateralPoolAddress).to.eq(agentCreatedArgs.collateralPool);
    });
});
