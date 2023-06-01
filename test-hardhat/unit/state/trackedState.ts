/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { time } from "@openzeppelin/test-helpers";
import { MockChain } from "../../../src/mock/MockChain";
import { TrackedState } from "../../../src/state/TrackedState";
import { EventArgs } from "../../../src/utils/events/common";
import { BN_ZERO, checkedCast, MAX_BIPS, QUERY_WINDOW_SECONDS, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { AgentCreated, AgentDestroyed } from "../../../typechain-truffle/AssetManager";
import { createTestAssetContext, getTestAssetTrackedStateContext, TestAssetBotContext, TestAssetTrackedStateContext } from "../../test-utils/create-test-asset-context";
import { lotSize } from "../../../src/fasset/Conversions";
import spies from "chai-spies";
import chaiAsPromised from "chai-as-promised";
import { expect, spy, use } from "chai";
import { createTestAgentB, createTestAgentBAndMakeAvailable, createCRAndPerformMinting, createTestMinter, disableMccTraceManager, mintAndDepositClass1ToOwner, createTestRedeemer, fromAgentInfoToInitialAgentData } from "../../test-utils/helpers";
import { decodeLiquidationStrategyImplSettings, encodeLiquidationStrategyImplSettings } from "../../../src/fasset/LiquidationStrategyImpl";
import { waitForTimelock } from "../../test-utils/new-asset-manager";
import { AgentStatus } from "../../../src/fasset/AssetManagerTypes";
import { artifacts } from "../../../src/utils/artifacts";
import { tokenBalance } from "../../../src/state/TokenPrice";
import { performRedemptionPayment } from "../../../test/test-utils/test-helpers";
import { PaymentReference } from "../../../src/fasset/PaymentReference";
import { requiredEventArgs } from "../../../src/utils/events/truffle";
use(chaiAsPromised);
use(spies);

const ERC20Mock = artifacts.require('ERC20Mock');

const agentDestroyedArgs = {
    '0': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    __length__: 1,
    agentVault: '0x094f7F426E4729d967216C2468DD1d44E2396e3d'
} as EventArgs<AgentDestroyed>;
const agentCreatedArgs = {
    '0': '0xedCdC766aA7DbB84004428ee0d35075375270E9B',
    '1': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    '2': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    '3': 'UNDERLYING_ACCOUNT_78988',
    '4': '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    '5': toBN(0),
    '6': toBN(0),
    '7': toBN(0),
    '8': toBN(0),
    '9': toBN(0),
    '10': toBN(0),
    '11': toBN(0),
    '12': toBN(0),
    __length__: 13,
    owner: '0xedCdC766aA7DbB84004428ee0d35075375270E9B',
    agentVault: '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    collateralPool: '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    underlyingAddress: 'UNDERLYING_ACCOUNT_78988',
    class1CollateralToken: '0x094f7F426E4729d967216C2468DD1d44E2396e3d',
    feeBIPS: toBN(0),
    poolFeeShareBIPS: toBN(0),
    mintingClass1CollateralRatioBIPS: toBN(0),
    mintingPoolCollateralRatioBIPS: toBN(0),
    buyFAssetByAgentFactorBIPS: toBN(0),
    poolExitCollateralRatioBIPS: toBN(0),
    poolTopupCollateralRatioBIPS: toBN(0),
    poolTopupTokenPriceFactorBIPS: toBN(0)
} as EventArgs<AgentCreated>;
const deposit = toBNExp(1_000_000, 18);


describe("Tracked state tests", async () => {
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

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
        governance = accounts[0];
        updateExecutor = accounts[11];
    });

    beforeEach(async () => {
        context = await createTestAssetContext(governance, testChainInfo.xrp, undefined, undefined, updateExecutor);
        trackedStateContext = getTestAssetTrackedStateContext(context);
        chain = checkedCast(trackedStateContext.chain, MockChain);
        const lastBlock = await web3.eth.getBlockNumber();
        trackedState = new TrackedState(trackedStateContext, lastBlock);
        await trackedState.initialize();
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
    });

    it("Should create agent", async () => {
        trackedState.createAgent(agentCreatedArgs);
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should create agent with current state", async () => {
        const agentBLocal = await createTestAgentB(context, accounts[0]);
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
        const agentBLocal = await createTestAgentB(context, accounts[0]);
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
        const spyPrices = spy.on(trackedState, 'getPrices');
        await trackedState.readUnhandledEvents()
        expect(spyPrices).to.have.been.called.once;
    });

    it("Should handle event 'AgentCreated'", async () => {
        await createTestAgentB(context, accounts[0]);
        expect(trackedState.agents.size).to.eq(0);
        await trackedState.readUnhandledEvents();
        expect(trackedState.agents.size).to.eq(1);
    });

    it("Should handle event 'AgentAvailable'", async () => {
        const ownerLocal = accounts[0];
        const agentBLocal = await createTestAgentB(context, ownerLocal);
        await mintAndDepositClass1ToOwner(context, agentBLocal.vaultAddress, deposit, ownerLocal);
        await agentBLocal.depositClass1Collateral(deposit);
        await agentBLocal.buyCollateralPoolTokens(deposit);
        await agentBLocal.makeAvailable();
        const agentBefore = trackedState.createAgent(await fromAgentInfoToInitialAgentData(agentBLocal));
        expect(agentBefore.publiclyAvailable).to.be.false;
        await trackedState.readUnhandledEvents();
        const agentAfter = trackedState.getAgent(agentBLocal.vaultAddress)!;
        expect(agentAfter.publiclyAvailable).to.be.true;
    });

    it("Should handle event 'AvailableAgentExited'", async () => {
        const ownerLocal = accounts[0];
        const agentBLocal = await createTestAgentB(context, ownerLocal);
        await mintAndDepositClass1ToOwner(context, agentBLocal.vaultAddress, deposit, ownerLocal);
        await agentBLocal.depositClass1Collateral(deposit);
        await agentBLocal.buyCollateralPoolTokens(deposit);
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
        const agentBLocal = await createTestAgentB(context, ownerLocal);
        await mintAndDepositClass1ToOwner(context, agentBLocal.vaultAddress, deposit, ownerLocal);
        await agentBLocal.depositClass1Collateral(deposit);
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
        const agentBLocal = await createTestAgentB(context, ownerAddress);
        await mintAndDepositClass1ToOwner(context, agentBLocal.vaultAddress, deposit, ownerAddress);
        await agentBLocal.depositClass1Collateral(deposit);
        await agentBLocal.buyCollateralPoolTokens(deposit);
        await agentBLocal.makeAvailable();
        const lots = 3;
        const supplyBefore = trackedState.fAssetSupply;
        // convert lots in uba
        const amountUBA = toBN(lots).mul(lotSize(await context.assetManager.getSettings()));
        const agentSettings = await agentBLocal.getAgentSettings();
        const poolFee = amountUBA.mul(toBN(agentSettings.feeBIPS)).mul(toBN(agentSettings.poolFeeShareBIPS))

        const randomUnderlyingAddress = "RANDOM_UNDERLYING";
        const allAmountUBA = amountUBA.add(poolFee);
        context.chain.mint(randomUnderlyingAddress, allAmountUBA);

        // const selfMint = await agentBLocal.selfMint(randomUnderlyingAddress, allAmountUBA, lots);
        const transactionHash = await agentBLocal.wallet.addTransaction(randomUnderlyingAddress, agentBLocal.underlyingAddress, allAmountUBA, PaymentReference.selfMint(agentBLocal.agentVault.address));
        const proof = await agentBLocal.attestationProvider.provePayment(transactionHash, null, agentBLocal.underlyingAddress);
        const res = await agentBLocal.assetManager.selfMint(proof, agentBLocal.agentVault.address, lots, { from: agentBLocal.ownerAddress });
        const selfMint = requiredEventArgs(res, 'MintingExecuted');


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
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await minter.reserveCollateral(agentB.vaultAddress, 2);
        const agentBefore = Object.assign({}, trackedState.createAgent(await fromAgentInfoToInitialAgentData(agentB)));
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress)!);
        expect(agentAfter.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
    });

    it("Should handle event 'MintingExecuted'", async () => {
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
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
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
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
            crt.lastUnderlyingBlock.toNumber(),
            crt.lastUnderlyingTimestamp.toNumber());
        await agentB.assetManager.mintingPaymentDefault(proof, crt.collateralReservationId, { from: agentB.ownerAddress });
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(agentMiddle.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
        expect(agentMiddle.reservedUBA.gt(agentAfter.reservedUBA)).to.be.true;
    });

    it("Should handle event 'RedemptionRequested' from collateral pool self close exit", async () => {
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
        const agentBefore = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        const minter = await createTestMinter(context, minterAddress, chain);
        // minter enters pool
        await agentB.collateralPool.enter(0, false, { value: toBNExp(100_000, 18), from: minter.address });
        // tweak some pool settings
        await context.assetManager.announceAgentSettingUpdate(agentB.vaultAddress, "poolFeeShareBIPS", 9999, { from: agentB.ownerAddress });
        await time.increase(toBN((await context.assetManager.getSettings()).agentFeeChangeTimelockSeconds));
        await context.assetManager.executeAgentSettingUpdate(agentB.vaultAddress, "poolFeeShareBIPS", { from: agentB.ownerAddress });
        await context.assetManager.announceAgentSettingUpdate(agentB.vaultAddress, "poolExitCollateralRatioBIPS", 88600, { from: agentB.ownerAddress });
        await time.increase(toBN((await context.assetManager.getSettings()).agentFeeChangeTimelockSeconds));
        await context.assetManager.executeAgentSettingUpdate(agentB.vaultAddress, "poolExitCollateralRatioBIPS", { from: agentB.ownerAddress });
        // minter performs minting
        const lots = 20;
        await createCRAndPerformMinting(minter, agentB.vaultAddress, lots, chain);
        // increase fAsset allowance
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.increaseAllowance(agentB.collateralPool.address, fBalance, { from: minter.address });
        // self close exit
        const tokensMinter = await agentB.collateralPoolToken.balanceOf(minter.address);
        await agentB.collateralPool.selfCloseExit(tokensMinter, false, minter.underlyingAddress, { from: minter.address });
        // handle events
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, await trackedState.getAgentTriggerAdd(agentB.vaultAddress));
        expect(agentAfter.poolRedeemingUBA.gt(agentBefore.poolRedeemingUBA));
    });

    it("Should handle event 'RedemptionPerformed'", async () => {
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
        const minter = await createTestMinter(context, minterAddress, chain);
        await trackedState.readUnhandledEvents();
        const lots = 2;
        await createCRAndPerformMinting(minter, agentB.vaultAddress, lots, chain);
        const spyRedemption = spy.on(trackedState.getAgent(agentB.vaultAddress)!, 'handleRedemptionPerformed');
        const redeemer = await createTestRedeemer(context, redeemerAddress);
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const [rdReqs] = await redeemer.requestRedemption(lots);
        const tx1Hash = await performRedemptionPayment(agentB, rdReqs[0]);
        const proof = await agentB.attestationProvider.provePayment(tx1Hash, agentB.underlyingAddress, rdReqs[0].paymentAddress);
        await agentB.assetManager.confirmRedemptionPayment(proof, rdReqs[0].requestId, { from: agentB.ownerAddress });
        await trackedState.readUnhandledEvents();
        expect(spyRedemption).to.have.been.called.once;
    });

    it("Should handle event 'CollateralReservationDeleted'", async () => {
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
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
        const burnNats = (await agentB.getPoolCollateralPrice()).convertUBAToTokenWei(crt.valueUBA).mul(toBN(settings.class1BuyForFlareFactorBIPS)).divn(MAX_BIPS);
        const proof = await agentB.attestationProvider.proveConfirmedBlockHeightExists();
        await agentB.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: agentB.ownerAddress, value: burnNats ?? BN_ZERO });
        await trackedState.readUnhandledEvents();
        const agentAfter = Object.assign({}, trackedState.getAgent(agentB.vaultAddress));
        expect(agentMiddle.reservedUBA.gt(agentBefore.reservedUBA)).to.be.true;
        expect(agentMiddle.reservedUBA.gt(agentAfter.reservedUBA)).to.be.true;
    });

    it("Should handle events 'UnderlyingWithdrawalAnnounced' and 'UnderlyingWithdrawalCancelled'", async () => {
        const agentBLocal = await createTestAgentB(context, ownerAddress);
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
        const agentBLocal = await createTestAgentB(context, ownerAddress);
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
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
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
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
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
        const paymentChallengeRewardBIPS_new = (toBN(trackedState.settings.paymentChallengeRewardBIPS).muln(4)).addn(100);
        await context.assetManagerController.setPaymentChallengeReward([context.assetManager.address], paymentChallengeRewardUSD5_new, paymentChallengeRewardBIPS_new, { from: governance });
        await trackedState.readUnhandledEvents();
        const settingsAfter = trackedState.settings;
        expect(settingsAfter.paymentChallengeRewardUSD5.toString()).to.eq(paymentChallengeRewardUSD5_new.toString());
        expect(settingsAfter.paymentChallengeRewardBIPS.toString()).to.eq(paymentChallengeRewardBIPS_new.toString());
    });

    it("Should handle event 'SettingArrayChanged'", async () => {
        const encodedSettings = await context.assetManager.getLiquidationSettings();
        const liquidationStrategySettings = decodeLiquidationStrategyImplSettings(encodedSettings);
        const newLiquidationStrategySettings = {
            ...liquidationStrategySettings,
            liquidationFactorClass1BIPS: liquidationStrategySettings.liquidationFactorClass1BIPS.slice(0, 2),
            liquidationCollateralFactorBIPS: [2_0000, 2_5000]
        }
        const settingsBefore = trackedState.liquidationStrategySettings;
        expect(settingsBefore.liquidationCollateralFactorBIPS[0].toString()).to.eq(liquidationStrategySettings.liquidationCollateralFactorBIPS[0].toString());
        expect(settingsBefore.liquidationCollateralFactorBIPS[1].toString()).to.eq(liquidationStrategySettings.liquidationCollateralFactorBIPS[1].toString());
        const resp = await context.assetManagerController.updateLiquidationStrategySettings([context.assetManager.address], encodeLiquidationStrategyImplSettings(newLiquidationStrategySettings), { from: governance });
        await waitForTimelock(resp, context.assetManagerController, updateExecutor);
        await trackedState.readUnhandledEvents();
        const settingsAfter = trackedState.liquidationStrategySettings;
        expect(settingsAfter.liquidationCollateralFactorBIPS[0].toString()).to.eq(newLiquidationStrategySettings.liquidationCollateralFactorBIPS[0].toString());
        expect(settingsAfter.liquidationCollateralFactorBIPS[1].toString()).to.eq(newLiquidationStrategySettings.liquidationCollateralFactorBIPS[1].toString());
    });

    it("Should handle events 'SettingChanged' and 'SettingArrayChanged' - invalid setting", async () => {
        const spyError = spy.on(console, 'error');
        const settingChangedEventFail = {
            address: trackedState.context.assetManager.address,
            type: 'event',
            signature: '0xac1fb27759c1e6f9e4a24d4f8c320be6091becb03cea5a95398fa220fca4ac0e',
            event: 'SettingChanged',
            args: {
                '0': 'lotSizeAMGFail',
                '1': toBN(0),
                __length__: 2,
                name: 'lotSizeAMGFail',
                value: toBN(0)
            },
            blockHash: '0xdc0640480d61a307ad0e7b67b8b7e3586bbd20aefa52620fb5b54f4a943a299d',
            blockNumber: 39,
            logIndex: 0,
            transactionHash: '0xf5081736c212077a16a512864ed480c60dfaf8f8d4d30bd452eec74125485cd5',
            transactionIndex: 0
        }
        const settingArrayChangedEventFail = {
            address: trackedState.context.assetManager.address,
            type: 'event',
            signature: '0xf8df5a8f8fc0ea5cc0d8aff70643ac14b7353b936a843e23cb08ff282ba74739',
            event: 'SettingArrayChanged',
            args: {
                '0': 'liquidationCollateralFactorBIPSFail',
                '1': [toBN(0), toBN(0)],
                __length__: 2,
                name: 'liquidationCollateralFactorBIPSFail',
                value: [toBN(0), toBN(0)]
            },
            blockHash: '0xb80d1ac278eb17ad869bcd5c7be9bd6c907db6a03dabb69ec43b72e24aba141e',
            blockNumber: 39,
            logIndex: 0,
            transactionHash: '0x4878b678646979bfe49669034562c6a8f0ad1765910d1db9109fb8245097e7c4',
            transactionIndex: 0
        }
        await trackedState.registerStateEvents([settingChangedEventFail]);
        await trackedState.registerStateEvents([settingArrayChangedEventFail]);
        expect(spyError).to.have.been.called.twice;
    });

    it("Should handle event 'AgentSettingChanged'", async () => {
        const agentBLocal = await createTestAgentB(context, accounts[0]);
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
        const agentB = await createTestAgentB(context, ownerAddress);
        const agentInfo = await agentB.getAgentInfo();
        await trackedState.createAgentWithCurrentState(agentB.vaultAddress);
        await mintAndDepositClass1ToOwner(context, agentB.vaultAddress, deposit, ownerAddress);
        await agentB.depositClass1Collateral(deposit.divn(2));
        await agentB.buyCollateralPoolTokens(deposit);
        // deposit class1 one more time
        await agentB.depositClass1Collateral(deposit.divn(2));
        await trackedState.readUnhandledEvents();
        await agentB.makeAvailable();
        await trackedState.readUnhandledEvents();
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalPoolCollateralNATWei.eq(deposit)).to.be.true;
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalClass1CollateralWei[agentInfo.class1CollateralToken].eq(deposit)).to.be.true;
        // redeem pool
        const amount = await tokenBalance(context.wNat.address, agentInfo.collateralPool);
        const withdrawAllowedAt = await agentB.announcePoolTokenRedemption(amount);
        await time.increaseTo(withdrawAllowedAt);
        await agentB.redeemCollateralPoolTokens(amount);
        await trackedState.readUnhandledEvents();
        expect(amount.eq(deposit)).to.be.true;
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalPoolCollateralNATWei.eqn(0)).to.be.true;
        expect(trackedState.agents.get(agentB.vaultAddress)?.totalClass1CollateralWei[agentInfo.class1CollateralToken].eq(deposit)).to.be.true;
    });

    it("Should handle event 'CollateralTypeAdded' and 'CollateralTypeDeprecated'", async () => {
        const collateralsBefore = trackedState.collaterals.list.length;
        const agentB = await createTestAgentBAndMakeAvailable(context, ownerAddress);
        const agentClass1Collateral = await agentB.getClass1CollateralToken();
        const newCollateral = Object.assign({}, agentClass1Collateral);
        newCollateral.token = (await ERC20Mock.new("New Token", "NT")).address;
        newCollateral.tokenFtsoSymbol = "NT";
        newCollateral.assetFtsoSymbol = "NT";
        await context.assetManagerController.addCollateralType([context.assetManager.address], newCollateral, { from: governance });
        await trackedState.readUnhandledEvents();
        const collateralsAfter = trackedState.collaterals.list.length;
        expect(collateralsAfter).to.eq(collateralsBefore + 1);
        await trackedState.readUnhandledEvents();
        const getCollateral0 = trackedState.collaterals.get(newCollateral.collateralClass, newCollateral.token);
        expect(toBN(getCollateral0.validUntil).eqn(0)).to.be.true;
        // deprecate
        const settings = await context.assetManager.getSettings();
        await context.assetManagerController.deprecateCollateralType([context.assetManager.address], newCollateral.collateralClass, newCollateral.token, settings.tokenInvalidationTimeMinSeconds, { from: governance });
        await trackedState.readUnhandledEvents();
        const getCollateral1 = trackedState.collaterals.get(newCollateral.collateralClass, newCollateral.token);
        expect(toBN(getCollateral1.validUntil).gtn(0)).to.be.true;
    });

    it("Should handle event 'CollateralRatiosChanged'", async () => {
        const collateral = trackedState.collaterals.list[0];
        const newMinCollateralRatioBIPS = "23000";
        const newCcbMinCollateralRatioBIPS = "18000";
        const newSafetyMinCollateralRatioBIPS = "24000";
        expect(collateral.minCollateralRatioBIPS.toString()).to.not.eq(newMinCollateralRatioBIPS);
        expect(collateral.ccbMinCollateralRatioBIPS.toString()).to.not.eq(newCcbMinCollateralRatioBIPS);
        expect(collateral.safetyMinCollateralRatioBIPS.toString()).to.not.eq(newSafetyMinCollateralRatioBIPS);
        const resp = await context.assetManagerController.setCollateralRatiosForToken([context.assetManager.address], collateral.collateralClass, collateral.token, newMinCollateralRatioBIPS, newCcbMinCollateralRatioBIPS, newSafetyMinCollateralRatioBIPS, { from: governance });
        await waitForTimelock(resp, context.assetManagerController, updateExecutor);
        await trackedState.readUnhandledEvents();
        const getCollateral = trackedState.collaterals.list[0];
        expect(getCollateral.minCollateralRatioBIPS.toString()).to.eq(newMinCollateralRatioBIPS);
        expect(getCollateral.ccbMinCollateralRatioBIPS.toString()).to.eq(newCcbMinCollateralRatioBIPS);
        expect(getCollateral.safetyMinCollateralRatioBIPS.toString()).to.eq(newSafetyMinCollateralRatioBIPS);
    });

});
