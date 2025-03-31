import { FilterQuery } from "@mikro-orm/core";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import { assert, expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { AgentBotCommands } from "../../../src/commands/AgentBotCommands";
import { loadAgentSettings } from "../../../src/config/AgentVaultInitSettings";
import { ORM } from "../../../src/config/orm";
import { AgentEntity, AgentRedemption, AgentUnderlyingPayment, AgentUpdateSetting, ReturnFromCoreVault } from "../../../src/entities/agent";
import { Agent, OwnerAddressPair } from "../../../src/fasset/Agent";
import { MockChain, MockChainWallet } from "../../../src/mock/MockChain";
import { CommandLineError, Currencies } from "../../../src/utils";
import { BN_ZERO, checkedCast, toBN, toBNExp, toStringExp } from "../../../src/utils/helpers";
import { artifacts, web3 } from "../../../src/utils/web3";
import { testAgentBotSettings, testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../../test/test-utils/create-test-orm";
import { testNotifierTransports } from "../../../test/test-utils/testNotifierTransports";
import { TestAssetBotContext, createTestAssetContext, ftsoUsdcInitialPrice, ftsoUsdtInitialPrice } from "../../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../../test-utils/hardhat-test-helpers";
import { DEFAULT_AGENT_SETTINGS_PATH_HARDHAT, createTestAgentBot, createTestMinter, mintAndDepositVaultCollateralToOwner, updateAgentBotUnderlyingBlockProof } from "../../test-utils/helpers";
import { fundUnderlying } from "../../../test/test-utils/test-helpers";
import { AgentRedemptionState, AgentSettingName, AgentUnderlyingPaymentState, AgentUnderlyingPaymentType, AgentUpdateSettingState, ReturnFromCoreVaultState } from "../../../src/entities/common";
import { AgentBot } from "../../../src/actors/AgentBot";
import { Secrets } from "../../../src/config/secrets";
import { TEST_SECRETS } from "../../../test/test-utils/test-bot-config";
import { eventArgs } from "../../../src/utils/events/truffle";
use(chaiAsPromised);
use(spies);

const depositAmountUSDC = toStringExp(100_000_000, 6);
const depositAmountWei = toStringExp(100_000_000, 18);
const withdrawAmount = toStringExp(100_000_000, 4);

const ERC20Mock = artifacts.require("ERC20Mock");
const FakeERC20 = artifacts.require("FakeERC20");

describe("AgentBot cli commands unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    const ownerUnderlyingAddress = "owner_underlying_1";
    const coreVaultUnderlyingAddress = "CORE_VAULT_UNDERLYING";
    let minterAddress: string;
    let botCliCommands: AgentBotCommands;
    let chain: MockChain;
    let governance: string;
    let secrets: Secrets;

    async function createAgent(contextToUse: TestAssetBotContext = context): Promise<Agent> {
        const agentBot = await createTestAgentBot(contextToUse, botCliCommands.orm, botCliCommands.owner.managementAddress, botCliCommands.ownerUnderlyingAddress);
        return agentBot.agent;
    }

    async function createAgentBot(contextToUse: TestAssetBotContext = context): Promise<AgentBot> {
        const agentBot = await createTestAgentBot(contextToUse, botCliCommands.orm, botCliCommands.owner.managementAddress, botCliCommands.ownerUnderlyingAddress);
        return agentBot;
    }

    async function triggerInstructionsAndPayFromCV(bot: AgentBot) {
        const triggerAccount = accounts[201];
        await bot.context.coreVaultManager!.addTriggeringAccounts([triggerAccount], { from: governance});
        const instruction = await bot.context.coreVaultManager!.triggerInstructions({ from: triggerAccount});
        const paymentReqs = eventArgs(instruction, "PaymentInstructions");
        const txHash = await context.wallet.addTransaction(coreVaultUnderlyingAddress, paymentReqs!.destination, paymentReqs!.amount, paymentReqs!.paymentReference)
    }

    before(async () => {
        accounts = await web3.eth.getAccounts();
        secrets = await new Secrets(TEST_SECRETS, { apiKey: {} });
        // accounts
        governance = accounts[0];
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(governance, { ...testChainInfo.xrp, finalizationBlocks: 0 }, { coreVaultUnderlyingAddress });
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        chain.mint(ownerUnderlyingAddress, toBNExp(50, 6));
        // bot cli commands
        const owner = new OwnerAddressPair(ownerAddress, ownerAddress);
        botCliCommands = new AgentBotCommands(context, testAgentBotSettings.xrp, owner, ownerUnderlyingAddress, orm, testNotifierTransports);
        return { orm, context, chain, botCliCommands };
    }

    beforeEach(async () => {
        ({ orm, context, chain, botCliCommands } = await loadFixtureCopyVars(initialize));
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should deposit to agent vault", async () => {
        const agent = await createAgent();
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent!, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(agent!.vaultAddress!, depositAmountUSDC);
        const collateral = await vaultCollateralTokenContract.balanceOf(agent!.vaultAddress!);
        expect(collateral.toString()).to.eq(depositAmountUSDC);
    });

    it("Should buy collateral pool tokens", async () => {
        const agent = await createAgent();
        await botCliCommands.buyCollateralPoolTokens(agent!.vaultAddress, depositAmountWei);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent!.vaultAddress } as FilterQuery<AgentEntity>);
        const collateral = await context.wNat.balanceOf(agentEnt.collateralPoolAddress);
        expect(collateral.toString()).to.eq(depositAmountWei);
    });

    it("Should buy both collaterals for n lots", async () => {
        const agent = await createAgent();
        // no testUSDC
        await expectRevert(botCliCommands.depositCollateralForLots(agent.vaultAddress, "5", "1.05"), "Not enough testUSDC on owner's work address.");
        await context.stablecoins.usdc.mintAmount(ownerAddress, toBNExp(100, 6), { from: governance });
        // no NAT
        const origBalance = await web3.eth.getBalance(ownerAddress);
        await setBalance(ownerAddress, 0);
        await expectRevert(botCliCommands.depositCollateralForLots(agent.vaultAddress, "5", "1.05"), "Not enough NAT on owner's work address.");
        await setBalance(ownerAddress, web3.utils.fromDecimal(origBalance));
        // everything ok
        await botCliCommands.depositCollateralForLots(agent.vaultAddress, "5", "1.05");
        const agentInfo = await agent.getAgentInfo();
        expect(Number(agentInfo.freeCollateralLots)).to.eq(5);
    });

    it("Should enter, announce exit available list and exit available list", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        // deposit to vault
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        const collateral = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmountUSDC);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        // try to exit - not in available list yet
        await expectRevert(botCliCommands.exitAvailableList(vaultAddress), "agent not available");
        const agentInfoBefore2 = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore2.publiclyAvailable).to.be.false;
        // enter available
        await botCliCommands.enterAvailableList(vaultAddress);
        const agentInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoMiddle.publiclyAvailable).to.be.true;
        // exit before announce
        await expectRevert(botCliCommands.exitAvailableList(vaultAddress), "exit not announced");
        // exit enter available
        await botCliCommands.announceExitAvailableList(vaultAddress!);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(toBN(agentEnt.exitAvailableAllowedAtTimestamp).gt(BN_ZERO)).to.be.true;
        // try to exit - not yet allowed
        await expectRevert(botCliCommands.exitAvailableList(vaultAddress), "cannot exit available list. Allowed at");
        const agentInfoMiddle2 = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoMiddle2.publiclyAvailable).to.be.true;
        // skip time
        await time.increaseTo(agentEnt.exitAvailableAllowedAtTimestamp);
        // try to exit - not yet allowed
        await botCliCommands.exitAvailableList(vaultAddress);
        const agentInfoAfter = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoAfter.publiclyAvailable).to.be.false;
    });

    it("Should deposit and withdraw from agent vault", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        const collateralBefore = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateralBefore.toString()).to.eq(depositAmountUSDC);
        await botCliCommands.announceWithdrawFromVault(vaultAddress, withdrawAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.withdrawalAllowedAtAmount).to.be.eq(withdrawAmount);
        expect(toBN(agentEnt.withdrawalAllowedAtTimestamp).gt(BN_ZERO)).to.be.true;
    });

    it("Should announce pool token redemption", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        const collateralBefore = toBN(await agent.collateralPoolToken.balanceOf(agent.vaultAddress));
        expect(collateralBefore.toString()).to.eq(depositAmountWei);
        await botCliCommands.announceRedeemCollateralPoolTokens(vaultAddress, withdrawAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.poolTokenRedemptionWithdrawalAllowedAtAmount).to.be.eq(withdrawAmount);
        expect(toBN(agentEnt.poolTokenRedemptionWithdrawalAllowedAtTimestamp).gt(BN_ZERO)).to.be.true;
    });

    it("Should self close", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        await botCliCommands.enterAvailableList(vaultAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        await context.fAsset.transfer(ownerAddress, fBalance, { from: minter.address });
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await botCliCommands.selfClose(vaultAddress, fBalance.divn(2).toString());
        const fBalanceAfter = await context.fAsset.balanceOf(ownerAddress);
        expect(fBalanceAfter.toString()).to.eq(fBalance.divn(2).sub(transferFee).toString());
    });

    it("Should close vault", async () => {
        const agent1 = await createAgent();
        await botCliCommands.closeVault(agent1.vaultAddress);
        const agentEnt1 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent1.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt1.waitingForDestructionCleanUp).to.be.true;

        const agent2 = await createAgent();
        await mintAndDepositVaultCollateralToOwner(context, agent2, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(agent2.vaultAddress, depositAmountUSDC);
        await botCliCommands.buyCollateralPoolTokens(agent2.vaultAddress, depositAmountWei);
        await botCliCommands.enterAvailableList(agent2.vaultAddress);
        await botCliCommands.closeVault(agent2.vaultAddress);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent2.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
        expect(toBN(agentEnt2.exitAvailableAllowedAtTimestamp).gtn(0)).to.be.true;
    });

    it("Should run command 'printAgentInfo'", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.printAgentInfo(agent.vaultAddress, false);
        expect(spyConsole).to.be.called();
    });

    it("Should run command 'printAgentInfo' (raw)", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.printAgentInfo(agent.vaultAddress, true);
        expect(spyConsole).to.be.called();
    });

    it("Should run command 'printAgentSettings'", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.printAgentSettings(agent.vaultAddress);
        expect(spyConsole).to.be.called();
    });

    it("Should run command 'updateAgentSetting'", async () => {
        const agent = await createAgent();
        // update feeBIPS
        const settingsName = "feeBIPS";
        const updateValue1 = "1100";
        const updateValue2 = "1200";
        await botCliCommands.updateAgentSetting(agent.vaultAddress, settingsName, updateValue1);
        await botCliCommands.updateAgentSetting(agent.vaultAddress, settingsName, updateValue2);
        const settingsUpdates = await orm.em.find(AgentUpdateSetting, { agentAddress: agent.vaultAddress, name: settingsName } as FilterQuery<AgentUpdateSetting>, { orderBy: { id: ('ASC') } });
        expect(settingsUpdates[0].state).to.eq(AgentUpdateSettingState.DONE);
        expect(settingsUpdates[1].state).to.eq(AgentUpdateSettingState.WAITING);
        // update invalid settings
        const invalidName = "invalid";
        await expect(botCliCommands.updateAgentSetting(agent.vaultAddress, invalidName, "8800")).to.eventually.be.rejectedWith(
            `Invalid setting name ${invalidName}. Valid names are: ${Object.values(AgentSettingName).join(', ')}`
        );
    });

    it("Should run command 'updateAgentSetting' with 'redemptionPoolFeeShareBIPS'", async () => {
        const agentBot = await createAgentBot();
        const agent = agentBot.agent;
        const initialRedemptionPoolFeeShareBIPS = toBN(await agent.getAgentSetting("redemptionPoolFeeShareBIPS"));
        expect(initialRedemptionPoolFeeShareBIPS.eq(BN_ZERO)).to.be.true;
        // update redemptionPoolFeeShareBIPS
        const settingsName = "redemptionPoolFeeShareBIPS";
        const updateValue1 = "1100";
        await botCliCommands.updateAgentSetting(agent.vaultAddress, settingsName, updateValue1);
        const settingsUpdates = await orm.em.find(AgentUpdateSetting, { agentAddress: agent.vaultAddress, name: settingsName } as FilterQuery<AgentUpdateSetting>, { orderBy: { id: ('ASC') } });
        expect(settingsUpdates[0].state).to.eq(AgentUpdateSettingState.WAITING);
        time.increaseTo(settingsUpdates[0].validAt);
        // run agent's steps until setting is updated
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check settings is updated
            orm.em.clear();
            const setting = await orm.em.findOneOrFail(AgentUpdateSetting, { name: settingsName }  as FilterQuery<AgentUpdateSetting> );
            console.log(`Agent step ${i}, state = ${setting.state}`);
            if (setting.state === AgentUpdateSettingState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // check
        const updatedRedemptionPoolFeeShareBIPS = toBN(await agent.getAgentSetting("redemptionPoolFeeShareBIPS"));
        expect(updatedRedemptionPoolFeeShareBIPS.eq(toBN(updateValue1))).to.be.true;

    });

    it("Should get pool fees balance'", async () => {
        const agent = await createAgent();
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(agent.vaultAddress, depositAmountUSDC);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmountWei);
        await botCliCommands.enterAvailableList(agent.vaultAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // show balance
        const fees = await botCliCommands.poolFeesBalance(agent.vaultAddress);
        expect(toBN(fees).gtn(0)).to.be.true;
    });

    it("Should withdraw pool fees", async () => {
        const agent = await createAgent();
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(agent.vaultAddress, depositAmountUSDC);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmountWei);
        await botCliCommands.enterAvailableList(agent.vaultAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // withdraw pool fees
        const amount = await botCliCommands.poolFeesBalance(agent.vaultAddress);
        await botCliCommands.withdrawPoolFees(agent.vaultAddress, toBN(amount).divn(2).toString());
        const amountAfter = await botCliCommands.poolFeesBalance(agent.vaultAddress);
        expect(toBN(amount).gt(toBN(amountAfter))).to.be.true;
    });

    it("Should run commands 'underlyingTopup' and then 'withdrawUnderlying'", async () => {
        const agentBot = await createAgentBot();
        const amountToWithdraw = toBN(100e6);
        // topup
        await fundUnderlying(context, agentBot.owner.workAddress, amountToWithdraw.muln(2));
        await botCliCommands.underlyingTopUp(agentBot.agent.vaultAddress, amountToWithdraw.muln(2));
        for (let i = 0; i < 5; i++) {
            await agentBot.runStep(orm.em);
            await time.increase(100);
            chain.mine(10);
        }
        // withdraw
        const txHash = await botCliCommands.withdrawUnderlying(agentBot.agent.vaultAddress, amountToWithdraw.toString(), "SomeRandomUnderlyingAddress");
        expect(txHash).to.not.be.undefined.and.to.not.be.null;
        const latest = await agentBot.underlyingManagement.getLatestOpenUnderlyingWithdrawal(orm.em, agentBot.agent.vaultAddress);
        expect(latest).to.not.be.null;
        expect(toBN(latest!.announcedAtTimestamp).gt(BN_ZERO)).to.be.true;
        for (let i = 0; i < 5; i++) {
            await agentBot.runStep(orm.em);
            await time.increase(100);
            chain.mine(10);
        }
        // there should be two payments in state of done
        orm.em.clear();
        const payments = await orm.em.find(AgentUnderlyingPayment, {});
        expect(payments.length).to.be.eq(2);
        expect(payments[0].state).to.be.eq(AgentUnderlyingPaymentState.DONE);
        expect(payments[0].type).to.be.eq(AgentUnderlyingPaymentType.TOP_UP);
        expect(payments[1].state).to.be.eq(AgentUnderlyingPaymentState.DONE);
        expect(payments[1].type).to.be.eq(AgentUnderlyingPaymentType.WITHDRAWAL);
        expect(String(await chain.getBalance("SomeRandomUnderlyingAddress"))).to.be.eq(String(amountToWithdraw));
    });

    it("Should run command 'withdrawUnderlying' and 'cancelUnderlyingWithdrawal'", async () => {
        const spyAnnounce = spy.on(botCliCommands, "withdrawUnderlying");
        const agentBot = await createAgentBot();
        const amountToWithdraw = toBN(100e6);
        // topup
        await fundUnderlying(context, agentBot.owner.workAddress, amountToWithdraw.muln(2));
        await botCliCommands.underlyingTopUp(agentBot.agent.vaultAddress, amountToWithdraw.muln(2));
        for (let i = 0; i < 5; i++) {
            await agentBot.runStep(orm.em);
            await time.increase(100);
            chain.mine(10);
        }
        // withdraw
        await botCliCommands.withdrawUnderlying(agentBot.agent.vaultAddress, amountToWithdraw.toString(), "SomeRandomUnderlyingAddress");
        // check
        const latest = await agentBot.underlyingManagement.getLatestOpenUnderlyingWithdrawal(orm.em, agentBot.agent.vaultAddress);
        if (latest === null) throw Error;
        expect(toBN(latest.announcedAtTimestamp).gt(BN_ZERO)).to.be.true;
        expect(spyAnnounce).to.be.called.once;
        // pretend that the transaction has failed
        const transaction = (context.wallet as MockChainWallet).transactionList[latest.txDbId!];
        transaction.status = 1;
        // cannot withdraw again while announcement is still active
        await expectRevert(botCliCommands.withdrawUnderlying(agentBot.agent.vaultAddress, amountToWithdraw.toString(), "SomeRandomUnderlyingAddress"),
            "announced underlying withdrawal active");
        //  not enough time passed
        await botCliCommands.cancelUnderlyingWithdrawal(agentBot.agent.vaultAddress);
        orm.em.clear();
        const latestToSoon = await agentBot.underlyingManagement.getLatestOpenUnderlyingWithdrawal(orm.em, agentBot.agent.vaultAddress);
        if (latestToSoon === null) throw Error;
        const latestId = latestToSoon.id;
        expect(toBN(latestToSoon.announcedAtTimestamp).gt(BN_ZERO)).to.be.true;
        expect(latestToSoon.cancelled).to.not.be.true;
        // time passed
        const settings = await context.assetManager.getSettings();
        await time.increase(settings.announcedUnderlyingConfirmationMinSeconds);
        await botCliCommands.cancelUnderlyingWithdrawal(agentBot.agent.vaultAddress);
        for (let i = 0; i < 3; i++) {
            await agentBot.runStep(orm.em);
        }
        orm.em.clear();
        const latestCancel = await orm.em.findOneOrFail(AgentUnderlyingPayment, { id: latestId });
        expect(latestCancel.cancelled).to.be.true;
    });

    it("Should run command 'cancelUnderlyingWithdrawal' - no active withdrawals", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.cancelUnderlyingWithdrawal(agent.vaultAddress);
        expect(spyConsole).to.be.called.once;
    });

    it("Should run command 'listActiveAgents'", async () => {
        await createAgent();
        const spyLog = spy.on(console, "log");
        await botCliCommands.listActiveAgents(context.fAssetSymbol);
        expect(spyLog).to.be.called.gt(0);
    });

    it("Should delegate and undelegate", async () => {
        const agent = await createAgent();
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmountWei);
        const del1 = accounts[101];
        const del2 = accounts[102];
        const del1Amount = "3000";
        const del2Amount = "5000";
        await botCliCommands.delegatePoolCollateral(agent.vaultAddress, del1, del1Amount);
        const delegations1 = (await botCliCommands.context.wNat.delegatesOf(agent.collateralPool.address)) as any;
        expect(delegations1._delegateAddresses[0]).to.eq(del1);
        expect(delegations1._bips[0].toString()).to.eq(del1Amount);
        await botCliCommands.delegatePoolCollateral(agent.vaultAddress, del2, del2Amount);
        const delegations2 = (await botCliCommands.context.wNat.delegatesOf(agent.collateralPool.address)) as any;
        expect(delegations2._delegateAddresses[1]).to.eq(del2);
        expect(delegations2._bips[1].toString()).to.eq(del2Amount);
        await botCliCommands.undelegatePoolCollateral(agent.vaultAddress);
        const { _delegateAddresses } = (await botCliCommands.context.wNat.delegatesOf(agent.collateralPool.address)) as any;
        expect(_delegateAddresses.length).to.eq(0);
    });

    it("Should run command 'getFreePoolCollateral', 'getFreeVaultCollateral' and 'getFreeUnderlying'", async () => {
        const agent = await createAgent();
        const freePool = await botCliCommands.getFreePoolCollateral(agent.vaultAddress);
        expect(freePool).to.eq("0");
        const freeVault = await botCliCommands.getFreeVaultCollateral(agent.vaultAddress);
        expect(freeVault).to.eq("0");
        const freeUnderlying = await botCliCommands.getFreeUnderlying(agent.vaultAddress);
        expect(freeUnderlying).to.eq("0");
        const safeToWithdrawUnderlying = await botCliCommands.getSafeToWithdrawUnderlying(agent.vaultAddress);
        expect(safeToWithdrawUnderlying).to.eq("0");
    });

    it("Should run command switch vault collateral", async () => {
        const agent = await createAgent();
        const agentVaultCollateral = await agent.getVaultCollateral();
        const newCollateral = Object.assign({}, agentVaultCollateral);
        const governanceSettingsAddress = await context.assetManagerController.governanceSettings();
        newCollateral.token = (await FakeERC20.new(governanceSettingsAddress, accounts[0], "New Token", "NT", 6)).address;
        newCollateral.tokenFtsoSymbol = "XRP";
        newCollateral.assetFtsoSymbol = "testUSDC";
        await context.assetManagerController.addCollateralType([context.assetManager.address], newCollateral, { from: governance });
        // deprecate
        const settings = await context.assetManager.getSettings();
        await context.assetManagerController.deprecateCollateralType(
            [context.assetManager.address],
            agentVaultCollateral.collateralClass,
            agentVaultCollateral.token,
            settings.tokenInvalidationTimeMinSeconds,
            { from: governance }
        );
        // switch collateral
        await botCliCommands.switchVaultCollateral(agent.agentVault.address, newCollateral.token);
        const agentVaultCollateralNew = await agent.getVaultCollateral();
        expect(agentVaultCollateralNew.token).to.eq(newCollateral.token);
    });

    it("Should switch vault collateral and auto deposit amount", async () => {
        const agent = await createAgent();
        await context.stablecoins.usdc.mintAmount(ownerAddress, toBNExp(100, 6), { from: governance });
        await agent.depositVaultCollateral(toBNExp(100, 6));
        const agentVaultCollateral = await agent.getVaultCollateral();
        const usdt = context.stablecoins.usdt;
        const depositAmount = await agent.calculateVaultCollateralReplacementAmount(usdt.address);
        expect(Number(depositAmount)).to.be.approximately(100e6 * ftsoUsdcInitialPrice / ftsoUsdtInitialPrice, 1);
        // deprecate
        const settings = await context.assetManager.getSettings();
        await context.assetManagerController.deprecateCollateralType(
            [context.assetManager.address],
            agentVaultCollateral.collateralClass,
            agentVaultCollateral.token,
            settings.tokenInvalidationTimeMinSeconds,
            { from: governance }
        );
        // switch collateral
        await context.stablecoins.usdt.mintAmount(ownerAddress, depositAmount, { from: governance });
        await botCliCommands.depositAndSwitchVaultCollateral(agent.agentVault.address, usdt.address);
        const agentVaultCollateralNew = await agent.getVaultCollateral();
        expect(agentVaultCollateralNew.token).to.eq(usdt.address);
        const newBalance = await usdt.balanceOf(agent.vaultAddress);
        expect(Number(newBalance)).to.be.equal(Number(depositAmount));
    });

    it("Should upgrade WNat", async () => {
        const assetManagerControllerAddress = accounts[301];
        const localContext = await createTestAssetContext(governance, testChainInfo.xrp, { assetManagerControllerAddress });
        const agent = await createAgent(localContext);
        botCliCommands.context = localContext;
        const newWnat = await ERC20Mock.new("Wrapped NAT", "WNAT");
        await localContext.assetManager.updateSystemContracts(localContext.assetManagerController.address, newWnat.address, { from: assetManagerControllerAddress });
        await botCliCommands.upgradeWNatContract(agent.vaultAddress);
        const token = (await agent.getPoolCollateral()).token;
        expect(token).to.equal(newWnat.address);
        //change context back
        botCliCommands.context = context;
    });

    it("Should create agent bot via bot cli commands", async () => {
        const settings = loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT);
        settings.poolTokenSuffix = "AB-X5";
        expect(await botCliCommands.context.assetManager.isPoolTokenSuffixReserved(settings.poolTokenSuffix)).equal(false);
        const agentBot = await botCliCommands.createAgentVault(settings, secrets);
        expect(agentBot).to.not.be.undefined;
        expect(await botCliCommands.context.assetManager.isPoolTokenSuffixReserved(settings.poolTokenSuffix)).equal(true);
        // cannot create vault twice with same token
        await expect(botCliCommands.createAgentVault(settings, secrets))
            .to.eventually.be.rejectedWith(/Agent vault with collateral pool token suffix ".*" already exists./)
            .and.to.be.instanceOf(CommandLineError);
    });

    it("Should validate collateral pool token syntax", async () => {
        await botCliCommands.validateCollateralPoolTokenSuffix("A-B8C-ZX15"); // should be ok
        await expect(botCliCommands.validateCollateralPoolTokenSuffix("abc"))
            .to.eventually.be.rejectedWith(/Collateral pool token suffix can contain only characters 'A'-'Z', '0'-'9' and '-', and cannot start or end with '-'./)
            .and.to.be.instanceOf(CommandLineError);
        await expect(botCliCommands.validateCollateralPoolTokenSuffix("-ABC"))
            .to.eventually.be.rejectedWith(/Collateral pool token suffix can contain only characters 'A'-'Z', '0'-'9' and '-', and cannot start or end with '-'./)
            .and.to.be.instanceOf(CommandLineError);
        await expect(botCliCommands.validateCollateralPoolTokenSuffix("01234567890123456789"))
            .to.eventually.be.rejectedWith(/Collateral pool token suffix ".*" is too long - maximum length is 19./)
            .and.to.be.instanceOf(CommandLineError);
        const settings = loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT);
        settings.poolTokenSuffix = "A-B8C-ZX15";
        await botCliCommands.createAgentVault(settings, secrets);
        await expect(botCliCommands.validateCollateralPoolTokenSuffix("A-B8C-ZX15"))
            .to.eventually.be.rejectedWith(/Agent vault with collateral pool token suffix ".*" already exists./)
            .and.to.be.instanceOf(CommandLineError);
    });

    it("Should run command 'cancelWithdrawFromVaultAnnouncement'", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.cancelWithdrawFromVaultAnnouncement(agent.vaultAddress);
        expect(spyConsole).to.be.called.once;
    });

    it("Should run command 'cancelCollateralPoolTokensAnnouncement'", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.cancelCollateralPoolTokenRedemption(agent.vaultAddress);
        expect(spyConsole).to.be.called.once;
    });

    it("Should run command 'prepareCreateAgentSettings'", async () => {
        const res = await botCliCommands.prepareCreateAgentSettings();
        expect(res.$schema).to.not.be.null;
        expect(res.poolTokenSuffix).to.eq("");
        expect(res.vaultCollateralFtsoSymbol).to.not.be.null;
        expect(res.fee).to.not.be.null;
        expect(res.poolFeeShare).to.not.be.null;
        expect(Number(res.mintingVaultCollateralRatio)).to.be.gt(0);
        expect(Number(res.mintingPoolCollateralRatio)).to.be.gt(0);
        expect(Number(res.poolExitCollateralRatio)).to.be.gt(0);
        expect(Number(res.poolTopupCollateralRatio)).to.be.gt(0);
        expect(Number(res.poolTopupTokenPriceFactor)).to.be.gt(0);
        expect(Number(res.buyFAssetByAgentFactor)).to.be.gt(0);
    });

    it("Should self mint", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        // deposit to vault
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        const collateral = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmountUSDC);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        // check free collateral lots
        const freeCollateralLots = toBN((await agent.getAgentInfo()).freeCollateralLots);
        const lotsToMint = toBN(1);
        // self mint
        await botCliCommands.selfMint(vaultAddress, lotsToMint);
        // check free collateral lots after
        const freeCollateralLotsAfter = toBN((await agent.getAgentInfo()).freeCollateralLots);
        expect(freeCollateralLotsAfter.eq(freeCollateralLots.sub(lotsToMint)));
    });

    it("Should not self mint - not enough lots", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        // deposit to vault
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        const collateral = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmountUSDC);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        // check free collateral lots
        const freeCollateralLots = toBN((await agent.getAgentInfo()).freeCollateralLots);
        const lotsToMint = freeCollateralLots.addn(1);
        // self mint
        await expect(botCliCommands.selfMint(vaultAddress, lotsToMint)).to.eventually.be.rejectedWith(
            `Cannot self mint. Agent ${vaultAddress} has available ${freeCollateralLots.toString()} lots`
        );
    });

    it("Should self mint from free underlying", async () => {
        const agentBot = await createAgentBot();
        const agent = agentBot.agent;
        const vaultAddress = agent.vaultAddress;
        // deposit to vault
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        const collateral = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmountUSDC);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        // check free collateral lots
        const freeCollateralLots = toBN((await agent.getAgentInfo()).freeCollateralLots);
        const lotsToMint = toBN(1);
        // top up agent
        const lotSize = toBN(await context.assetManager.lotSize());
        const amountUBA = lotsToMint.mul(lotSize).muln(2).add(toBN(20e6));
        await agentBot.underlyingManagement.underlyingTopUp(orm.em, amountUBA);
        chain.mine(chain.finalizationBlocks + 1);
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
        // self mint
        await botCliCommands.selfMintFromFreeUnderlying(vaultAddress, lotsToMint);
        // check free collateral lots after
        const freeCollateralLotsAfter = toBN((await agent.getAgentInfo()).freeCollateralLots);
        expect(freeCollateralLotsAfter.eq(freeCollateralLots.sub(lotsToMint)));
    });

    it("Should not self mint from free underlying - not enough lots", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        // deposit to vault
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        const collateral = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmountUSDC);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        // check free collateral lots
        const freeCollateralLots = toBN((await agent.getAgentInfo()).freeCollateralLots);
        const lotsToMint = freeCollateralLots.addn(1);
        // self mint
        await expect(botCliCommands.selfMintFromFreeUnderlying(vaultAddress, lotsToMint)).to.eventually.be.rejectedWith(
            `Cannot self mint from free underlying. Agent ${vaultAddress} has available ${freeCollateralLots.toString()} lots`
        );
    });

    it("Should not self mint from free underlying - not enough free underlying", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        // deposit to vault
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        const collateral = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmountUSDC);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        // check free collateral lots
        const lotsToMint = toBN(1);
        // self mint
        const toPayUBA = await agent.getSelfMintPaymentAmount(lotsToMint);
        const freeUnderlyingUBA = toBN(((await agent.getAgentInfo()).freeUnderlyingBalanceUBA));
        const currency = await Currencies.fassetUnderlyingToken(context);
        await expect(botCliCommands.selfMintFromFreeUnderlying(vaultAddress, lotsToMint)).to.eventually.be.rejectedWith(
            `Cannot self mint from free underlying. Agent ${vaultAddress} has available ${currency.format(freeUnderlyingUBA)} on vault underlying address, but needs ${currency.format(toPayUBA)}.`
        );
    });

    it("Should create 'transferToCV' redemption request", async () => {
        const bot = await createAgentBot();
        const vaultAddress = bot.agent.vaultAddress;
        await mintAndDepositVaultCollateralToOwner(context, bot.agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        await botCliCommands.enterAvailableList(vaultAddress);
        const amountToWithdraw = toBN(10e6);
        // topup
        await fundUnderlying(context, bot.owner.workAddress, amountToWithdraw.muln(2));
        await botCliCommands.underlyingTopUp(bot.agent.vaultAddress, amountToWithdraw.muln(2));
        for (let i = 0; i < 5; i++) {
            await bot.runStep(orm.em);
            await time.increase(100);
            chain.mine(10);
        }
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer to core vault
        const result = await botCliCommands.getMaximumTransferToCoreVault(vaultAddress);
        const currency = await Currencies.fasset(bot.context);
        await expect(botCliCommands.transferToCoreVault(vaultAddress, result.maximumTransferUBA.addn(1))).to.eventually.be.rejectedWith(
            `Cannot transfer funds. Requested amount ${currency.format(result.maximumTransferUBA.addn(1), { unit: false })} is higher than allowed ${currency.format(result.maximumTransferUBA, { unit: false })}`
        )
        const res = await botCliCommands.transferToCoreVault(vaultAddress, result.maximumTransferUBA);
        const transferRedemptionId = toBN(res.transferRedemptionRequestId);
        // run agent's steps and wait for redemption with request id = transferRedemptionId
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, bot);
            await time.advanceBlock();
            chain.mine();
            await bot.runStep(orm.em);
            // check if redemption exist
            orm.em.clear();
            const redemption = await orm.em.findOne(AgentRedemption, { requestId: transferRedemptionId }  as FilterQuery<AgentRedemption> );
            if (redemption) {
                console.log(`Agent step ${i}, state = ${redemption.state}`);
                if (redemption.state === AgentRedemptionState.DONE) break;
            }
            assert.isBelow(i, 50);  // prevent infinite loops
        }
    });

    it("Should create 'returnFromCV' redemption request and cancel it", async () => {
        const bot = await createAgentBot();
        const vaultAddress = bot.agent.vaultAddress;
        await mintAndDepositVaultCollateralToOwner(context, bot.agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        await botCliCommands.enterAvailableList(vaultAddress);
        const amountToWithdraw = toBN(10e6);
        // topup
        await fundUnderlying(context, bot.owner.workAddress, amountToWithdraw.muln(2));
        await botCliCommands.underlyingTopUp(bot.agent.vaultAddress, amountToWithdraw.muln(2));
        for (let i = 0; i < 5; i++) {
            await bot.runStep(orm.em);
            await time.increase(100);
            chain.mine(10);
        }
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(vaultAddress, 10);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer to core vault
        const result = await botCliCommands.getMaximumTransferToCoreVault(vaultAddress);
        const res = await botCliCommands.transferToCoreVault(vaultAddress, result.maximumTransferUBA);
        const transferRedemptionId = toBN(res.transferRedemptionRequestId);
        // run agent's steps and wait for redemption with request id = transferRedemptionId
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, bot);
            await time.advanceBlock();
            chain.mine();
            await bot.runStep(orm.em);
            // check if redemption exist
            orm.em.clear();
            const redemption = await orm.em.findOne(AgentRedemption, { requestId: transferRedemptionId }  as FilterQuery<AgentRedemption> );
            if (redemption) {
                console.log(`Agent step ${i}, state = ${redemption.state}`);
                if (redemption.state === AgentRedemptionState.DONE) break;
            }
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // allow return from cv for agent
        await bot.context.coreVaultManager?.addAllowedDestinationAddresses([bot.agent.underlyingAddress], { from: governance })
        const resReturn = await botCliCommands.returnFromCoreVault(vaultAddress, toBN(1));
        // run agent's steps and wait for return from cv
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, bot);
            await time.advanceBlock();
            chain.mine();
            await bot.runStep(orm.em);
            // check if redemption exist
            orm.em.clear();
            const returnFromCoreVault = await orm.em.findOne(ReturnFromCoreVault, { requestId: resReturn.requestId }  as FilterQuery<ReturnFromCoreVault> );
            if (returnFromCoreVault) {
                console.log(`Agent step ${i}, state = ${returnFromCoreVault.state}`);
                if (returnFromCoreVault.state === ReturnFromCoreVaultState.STARTED) break;
            }
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // cancel return from cv for agent
        await botCliCommands.cancelReturnFromCoreVault(bot.agent.vaultAddress);
        // run agent's steps and wait for return from cv to be cancelled
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, bot);
            await time.advanceBlock();
            chain.mine();
            await bot.runStep(orm.em);
            // check if redemption exist
            orm.em.clear();
            const returnFromCoreVault = await orm.em.findOne(ReturnFromCoreVault, { requestId: resReturn.requestId }  as FilterQuery<ReturnFromCoreVault> );
            if (returnFromCoreVault) {
                console.log(`Agent step ${i}, state = ${returnFromCoreVault.state}`);
                if (returnFromCoreVault.state === ReturnFromCoreVaultState.DONE && returnFromCoreVault.cancelled === true) break;
            }
            assert.isBelow(i, 50);  // prevent infinite loops
        }
    });

    it("Should create and confirm'returnFromCV' redemption request", async () => {
        const bot = await createAgentBot();
        const vaultAddress = bot.agent.vaultAddress;
        await mintAndDepositVaultCollateralToOwner(context, bot.agent, toBN(depositAmountUSDC), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmountUSDC);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmountWei);
        await botCliCommands.enterAvailableList(vaultAddress);
        const amountToWithdraw = toBN(10e6);
        // topup
        await fundUnderlying(context, bot.owner.workAddress, amountToWithdraw.muln(2));
        await botCliCommands.underlyingTopUp(bot.agent.vaultAddress, amountToWithdraw.muln(2));
        for (let i = 0; i < 5; i++) {
            await bot.runStep(orm.em);
            await time.increase(100);
            chain.mine(10);
        }
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(vaultAddress, 10);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer to core vault
        const result = await botCliCommands.getMaximumTransferToCoreVault(vaultAddress);
        const res = await botCliCommands.transferToCoreVault(vaultAddress, result.maximumTransferUBA);
        const transferRedemptionId = toBN(res.transferRedemptionRequestId);
        // run agent's steps and wait for redemption with request id = transferRedemptionId
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, bot);
            await time.advanceBlock();
            chain.mine();
            await bot.runStep(orm.em);
            // check if redemption exist
            orm.em.clear();
            const redemption = await orm.em.findOne(AgentRedemption, { requestId: transferRedemptionId }  as FilterQuery<AgentRedemption> );
            if (redemption) {
                console.log(`Agent step ${i}, state = ${redemption.state}`);
                if (redemption.state === AgentRedemptionState.DONE) break;
            }
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // allow return from cv for agent
        await bot.context.coreVaultManager?.addAllowedDestinationAddresses([bot.agent.underlyingAddress], { from: governance })
        const resReturn = await botCliCommands.returnFromCoreVault(vaultAddress, toBN(1));
        // run agent's steps and wait for return from cv
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, bot);
            await time.advanceBlock();
            chain.mine();
            await bot.runStep(orm.em);
            // check if redemption exist
            orm.em.clear();
            const returnFromCoreVault = await orm.em.findOne(ReturnFromCoreVault, { requestId: resReturn.requestId }  as FilterQuery<ReturnFromCoreVault> );
            if (returnFromCoreVault) {
                console.log(`Agent step ${i}, state = ${returnFromCoreVault.state}`);
                if (returnFromCoreVault.state === ReturnFromCoreVaultState.STARTED) break;
            }
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        await triggerInstructionsAndPayFromCV(bot);
        // run agent's steps and wait for return from cv to be performed
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, bot);
            await time.advanceBlock();
            chain.mine();
            await bot.runStep(orm.em);
            // check if redemption exist
            orm.em.clear();
            const returnFromCoreVault = await orm.em.findOne(ReturnFromCoreVault, { requestId: resReturn.requestId }  as FilterQuery<ReturnFromCoreVault> );
            if (returnFromCoreVault) {
                console.log(`Agent step ${i}, state = ${returnFromCoreVault.state}`);
                if (returnFromCoreVault.state === ReturnFromCoreVaultState.DONE) break;
            }
            assert.isBelow(i, 50);  // prevent infinite loops
        }
    });
});
