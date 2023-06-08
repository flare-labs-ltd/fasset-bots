/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ORM } from "../../../src/config/orm";
import { BN_ZERO, checkedCast, toBN, toStringExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { BotCliCommands, listUsageAndCommands } from "../../../src/cli/BotCliCommands";
import { MockChain, MockChainWallet } from "../../../src/mock/MockChain";
import { AgentEntity } from "../../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core";
import { Notifier } from "../../../src/utils/Notifier";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";
import { artifacts } from "../../../src/utils/artifacts";
import { MockIndexer } from "../../../src/mock/MockIndexer";
import spies from "chai-spies";
import chaiAsPromised from "chai-as-promised";
import { expect, spy, use } from "chai";
import { createTestMinter, disableMccTraceManager, mintAndDepositClass1ToOwner } from "../../test-utils/helpers";
import { time } from "@openzeppelin/test-helpers";
import { Agent } from "../../../src/fasset/Agent";
use(chaiAsPromised);
use(spies);

const depositAmount = toStringExp(100_000_000, 18);
const withdrawAmount = toStringExp(100_000_000, 4);
const StateConnector = artifacts.require('StateConnectorMock');

describe("Bot cli commands unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let botCliCommands: BotCliCommands;
    let chain: MockChain;

    async function createAgent(): Promise<Agent> {
        const agent = await botCliCommands.createAgentVault();
        return agent!;
    }

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        // accounts
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.chain, MockChain);
        // bot cli commands
        botCliCommands = new BotCliCommands();
        botCliCommands.context = context;
        botCliCommands.ownerAddress = ownerAddress;
        const chainId = 3;
        botCliCommands.botConfig = {
            rpcUrl: "",
            loopDelay: 0,
            stateConnector: new MockStateConnectorClient(await StateConnector.new(), "auto"),
            chains: [{
                chainInfo: {
                    chainId: chainId,
                    name: "Ripple",
                    symbol: "XRP",
                    decimals: 6,
                    amgDecimals: 0,
                    requireEOAProof: false
                },
                chain: chain,
                wallet: new MockChainWallet(chain),
                blockChainIndexerClient: new MockIndexer("", chainId, chain),
                assetManager: "",
            }],
            nativeChainInfo: {
                finalizationBlocks: 0,
                readLogsChunkSize: 0,
            },
            orm: orm,
            notifier: new Notifier(),
            addressUpdater: ""
        };
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should create agent vault", async () => {
        const agent = await createAgent();
        expect(agent!.vaultAddress).to.not.be.null;
    });

    it("Should deposit to agent vault", async () => {
        const agent = await createAgent();
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent!.vaultAddress!, depositAmount);
        const collateral = await class1TokenContract.balanceOf(agent!.vaultAddress!);
        expect(collateral.toString()).to.eq(depositAmount);
    });

    it("Should buy collateral pool tokens", async () => {
        const agent = await createAgent();
        await botCliCommands.buyCollateralPoolTokens(agent!.vaultAddress, depositAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent!.vaultAddress } as FilterQuery<AgentEntity>);
        const collateral = await context.wNat.balanceOf(agentEnt.collateralPoolAddress);
        expect(collateral.toString()).to.eq(depositAmount);
    });

    it("Should enter and announce exit available list", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        // deposit to vault
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateral = await class1TokenContract.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmount);
        // enter available
        await botCliCommands.enterAvailableList(vaultAddress);
        const agentInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoMiddle.publiclyAvailable).to.be.true;
        // exit enter available
        await botCliCommands.announceExitAvailableList(vaultAddress!);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    });

    it("Should deposit and withdraw from agent vault", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateralBefore = await class1TokenContract.balanceOf(vaultAddress);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.withdrawFromVault(vaultAddress, withdrawAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.withdrawalAllowedAtAmount).to.be.eq(withdrawAmount);
        expect(agentEnt.withdrawalAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    })

    it("Should self close", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(ownerAddress, fBalance, { from: minter.address });
        await botCliCommands.selfClose(vaultAddress, fBalance.divn(2).toString());
        const fBalanceAfter = await context.fAsset.balanceOf(ownerAddress);
        expect(fBalanceAfter.toString()).to.eq(fBalance.divn(2).toString());
    });

    it("Should close vault", async () => {
        const agent1 = await createAgent();
        await botCliCommands.closeVault(agent1.vaultAddress);
        const agentEnt1 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent1.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt1.waitingForDestructionCleanUp).to.be.true;

        const agent2 = await createAgent();
        await mintAndDepositClass1ToOwner(context, agent2, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent2.vaultAddress, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(agent2.vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(agent2.vaultAddress);
        await botCliCommands.closeVault(agent2.vaultAddress);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent2.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
        expect(agentEnt2.exitAvailableAllowedAtTimestamp.gtn(0)).to.be.true;
    });

    it("Should list usage commands", async () => {
        const spyLog = spy.on(console, "log");
        listUsageAndCommands();
        await botCliCommands.run([]);
        await botCliCommands.run(["", "", "unknownCommand"]);
        expect(spyLog).to.be.called.exactly(54);
    });

    it("Should run command 'create'", async () => {
        const spyAgent = spy.on(botCliCommands, "createAgentVault");
        await botCliCommands.run(["", "", "create"]);
        expect(spyAgent).to.be.called.once;

    });

    it("Should run command 'depositClass1'", async () => {
        const spyDeposit = spy.on(botCliCommands, "depositToVault");
        const agent = await createAgent();
        await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.run(["", "", "depositClass1", agent.vaultAddress, depositAmount]);
        expect(spyDeposit).to.be.called.once;
    });

    it("Should not run command 'depositClass1' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "depositClass1"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'buyPoolCollateral'", async () => {
        const agent = await createAgent();
        expect((await context.assetManager.getAgentInfo(agent.vaultAddress)).totalAgentPoolTokensWei).to.eq("0");
        await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent.vaultAddress, depositAmount);
        await botCliCommands.run(["", "", "buyPoolCollateral", agent.vaultAddress, depositAmount]);
        expect((await context.assetManager.getAgentInfo(agent.vaultAddress)).totalAgentPoolTokensWei).to.eq(depositAmount);
    });

    it("Should not run command 'buyPoolCollateral' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "buyPoolCollateral"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'updateAgentSetting'", async () => {
        const agent = await createAgent();
        const settingName = "feeBIPS";
        const settingValue = "1100";
        await botCliCommands.run(["", "", "updateAgentSetting", agent.vaultAddress, settingName, settingValue]);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.agentSettingUpdateValidAtTimestamp.gtn(0)).to.be.true;
        expect(agentEnt.agentSettingUpdateValidAtName).to.eq(settingName);
    });

    it("Should not run command 'updateAgentSetting' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "updateAgentSetting"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run commands 'enter' and 'exit'", async () => {
        const agent = await createAgent();
        // deposit to vault
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmount);
        await botCliCommands.depositToVault(agent.vaultAddress, depositAmount);
        const collateral = await class1TokenContract.balanceOf(agent.vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
        const agentInfoBefore = await context.assetManager.getAgentInfo(agent.vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // enter available
        await botCliCommands.run(["", "", "enter", agent.vaultAddress]);
        const agentInfoMiddle = await context.assetManager.getAgentInfo(agent.vaultAddress);
        expect(agentInfoMiddle.publiclyAvailable).to.be.true;
        // announce exit
        await botCliCommands.run(["", "", "exit", agent.vaultAddress]);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    });

    it("Should not run command 'enter' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "enter"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should not run command 'exit' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "exit"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run commands 'depositClass1' and 'withdrawClass1", async () => {
        const agent = await createAgent();
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.run(["", "", "depositClass1", agent.vaultAddress, depositAmount]);
        const collateralBefore = await class1TokenContract.balanceOf(agent.vaultAddress);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.run(["", "", "withdrawClass1", agent.vaultAddress, withdrawAmount]);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.withdrawalAllowedAtAmount).to.eq(withdrawAmount);
        expect(agentEnt.withdrawalAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    });

    it("Should not run command 'depositClass1' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "depositClass1"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should not run command 'withdrawClass1' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "withdrawClass1"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'selfClose'", async () => {
        const agent = await createAgent();
        await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent.vaultAddress, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(agent.vaultAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(ownerAddress, fBalance, { from: minter.address });
        await botCliCommands.run(["", "", "selfClose", agent.vaultAddress, fBalance.divn(2).toString()]);
        const fBalanceAfter = await context.fAsset.balanceOf(ownerAddress);
        expect(fBalanceAfter.toString()).to.eq(fBalance.divn(2).toString());
    });

    it("Should not run command 'selfClose' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "selfClose"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'close'", async () => {
        const agent1 = await createAgent();
        await botCliCommands.run(["", "", "close", agent1.vaultAddress]);
        const agentEnt1 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent1.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt1.waitingForDestructionCleanUp).to.be.true;

        const agent2  = await createAgent();
        await mintAndDepositClass1ToOwner(context, agent2, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent2.vaultAddress, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(agent2.vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(agent2.vaultAddress);
        await botCliCommands.run(["", "", "close", agent2.vaultAddress]);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent2.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
    });

    it("Should not run command 'close' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "close"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'poolFeesBalance'", async () => {
        const spyDeposit = spy.on(botCliCommands, "poolFeesBalance");
        const agent = await createAgent();
        await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent.vaultAddress, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(agent.vaultAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // show balance
        await botCliCommands.run(["", "", "poolFeesBalance", agent.vaultAddress]);
        expect(spyDeposit).to.be.called.once;
    });

    it("Should not run command 'poolFeesBalance' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "poolFeesBalance"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'withdrawPoolFees'", async () => {
        const spyDeposit = spy.on(botCliCommands, "withdrawPoolFees");
        const agent = await createAgent();
        await mintAndDepositClass1ToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent.vaultAddress, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(agent.vaultAddress);
        // execute minting
        const minter = await createTestMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // withdraw pool fees
        const amount = (await botCliCommands.poolFeesBalance(agent.vaultAddress)).divn(2);
        await botCliCommands.run(["", "", "withdrawPoolFees", agent.vaultAddress, amount.toString()]);
        expect(spyDeposit).to.be.called.once;
    });

    it("Should not run command 'withdrawPoolFees' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "withdrawPoolFees"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'announceUnderlyingWithdrawal' and 'cancelUnderlyingWithdrawal'", async () => {
        const spyAnnounce = spy.on(botCliCommands, "announceUnderlyingWithdrawal");
        const agent = await createAgent();
        await botCliCommands.run(["", "", "announceUnderlyingWithdrawal", agent.vaultAddress]);
        const agentEntAnnounce = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntAnnounce.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        expect(spyAnnounce).to.be.called.once;
        const spyCancel = spy.on(botCliCommands, "cancelUnderlyingWithdrawal");
        //  not enough time passed
        await botCliCommands.run(["", "", "cancelUnderlyingWithdrawal", agent.vaultAddress]);
        const agentEntCancelTooSoon = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntCancelTooSoon.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        // time passed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await botCliCommands.run(["", "", "cancelUnderlyingWithdrawal", agent.vaultAddress]);
        const agentEntCancel = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntCancel.underlyingWithdrawalAnnouncedAtTimestamp.eq(BN_ZERO)).to.be.true;
        expect(spyCancel).to.be.called.twice;
    });

    it("Should run command 'cancelUnderlyingWithdrawal' - no active withdrawals", async () => {
        const spyConfirm = spy.on(botCliCommands, "cancelUnderlyingWithdrawal");
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.run(["", "", "cancelUnderlyingWithdrawal", agent.vaultAddress!]);
        expect(spyConfirm).to.be.called.once;
        expect(spyConsole).to.be.called.once;
    });

    it("Should not run command 'announceUnderlyingWithdrawal' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "announceUnderlyingWithdrawal"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should not run command 'cancelUnderlyingWithdrawal' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "cancelUnderlyingWithdrawal"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'performUnderlyingWithdrawal'", async () => {
        const spyPerform = spy.on(botCliCommands, "performUnderlyingWithdrawal");
        const agent = await createAgent();
        const paymentReference = await botCliCommands.announceUnderlyingWithdrawal(agent.vaultAddress);
        const amountToWithdraw = 100;
        await botCliCommands.run(["", "", "performUnderlyingWithdrawal", agent.vaultAddress, amountToWithdraw.toString(), "SomeRandomUnderlyingAddress", paymentReference!]);
        expect(spyPerform).to.be.called.once;
    });

    it("Should not run command 'performUnderlyingWithdrawal' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "performUnderlyingWithdrawal"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'confirmUnderlyingWithdrawal'", async () => {
        const spyConfirm = spy.on(botCliCommands, "confirmUnderlyingWithdrawal");
        const agent = await createAgent();
        const paymentReference = await botCliCommands.announceUnderlyingWithdrawal(agent.vaultAddress);
        const agentEntAnnounce = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntAnnounce.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        const amountToWithdraw = 100;
        const txHash = await botCliCommands.performUnderlyingWithdrawal(agent.vaultAddress, amountToWithdraw.toString(), "SomeRandomUnderlyingAddress", paymentReference!);
        chain.mine(chain.finalizationBlocks + 1);
        //  not enough time passed
        await botCliCommands.run(["", "", "confirmUnderlyingWithdrawal", agent.vaultAddress, txHash]);
        const agentEntConfirmToSoon = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntConfirmToSoon.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        expect(agentEntConfirmToSoon.underlyingWithdrawalConfirmTransaction).to.eq(txHash);
        // time passed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await botCliCommands.run(["", "", "confirmUnderlyingWithdrawal", agent.vaultAddress, txHash]);
        const agentEntConfirm = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntConfirm.underlyingWithdrawalAnnouncedAtTimestamp.eq(BN_ZERO)).to.be.true;
        expect(agentEntConfirm.underlyingWithdrawalConfirmTransaction).to.eq("");
        expect(spyConfirm).to.be.called.twice;
    });

    it("Should run command 'confirmUnderlyingWithdrawal' - no active withdrawals", async () => {
        const spyConfirm = spy.on(botCliCommands, "confirmUnderlyingWithdrawal");
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.run(["", "", "confirmUnderlyingWithdrawal", agent.vaultAddress, "txHash"]);
        expect(spyConfirm).to.be.called.once;
        expect(spyConsole).to.be.called.once;
    });

    it("Should not run command 'confirmUnderlyingWithdrawal' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "confirmUnderlyingWithdrawal"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'listActiveAgents'", async () => {
        await botCliCommands.createAgentVault();
        const spyLog = spy.on(console, "log");
        await botCliCommands.listActiveAgents();
        await botCliCommands.run(["", "", "listAgents"]);
        expect(spyLog).to.be.called.gt(0);
    });

});

