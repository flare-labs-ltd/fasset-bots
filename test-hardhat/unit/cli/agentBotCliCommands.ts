/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ORM } from "../../../src/config/orm";
import { BN_ZERO, checkedCast, toBN, toStringExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo, testNativeChainInfo } from "../../../test/test-utils/TestChainInfo";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { BotCliCommands } from "../../../src/actors/AgentBotCliCommands";
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
import { createTestMinter, disableMccTraceManager, mintAndDepositVaultCollateralToOwner } from "../../test-utils/helpers";
import { time } from "@openzeppelin/test-helpers";
import { Agent } from "../../../src/fasset/Agent";
import { createTestAgentBot } from "../../test-utils/helpers";
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
        const agentBot = await createTestAgentBot(context, botCliCommands.botConfig.orm!, botCliCommands.ownerAddress);
        return agentBot.agent;
    }

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate', type: 'sqlite' }));
        // accounts
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // bot cli commands
        botCliCommands = new BotCliCommands();
        botCliCommands.context = context;
        botCliCommands.ownerAddress = ownerAddress;
        const chainId = 3;
        botCliCommands.botConfig = {
            rpcUrl: "",
            loopDelay: 0,
            chains: [{
                chainInfo: {
                    chainId: chainId,
                    name: "Ripple",
                    symbol: "XRP",
                    decimals: 6,
                    amgDecimals: 0,
                    requireEOAProof: false
                },
                wallet: new MockChainWallet(chain),
                blockchainIndexerClient: new MockIndexer("", chainId, chain),
                stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainId]: chain }, "auto"),
                assetManager: "",
            }],
            nativeChainInfo: testNativeChainInfo,
            orm: orm,
            notifier: new Notifier(),
            addressUpdater: ""
        };
    });

    afterEach(function () {
        spy.restore(console);
    });

    it("Should deposit to agent vault", async () => {
        const agent = await createAgent();
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent!.vaultAddress!, depositAmount);
        const collateral = await vaultCollateralTokenContract.balanceOf(agent!.vaultAddress!);
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
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateral = await vaultCollateralTokenContract.balanceOf(vaultAddress);
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
        const vaultCollateralTokenContract = await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateralBefore = await vaultCollateralTokenContract.balanceOf(vaultAddress);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.withdrawFromVault(vaultAddress, withdrawAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.withdrawalAllowedAtAmount).to.be.eq(withdrawAmount);
        expect(agentEnt.withdrawalAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    })

    it("Should self close", async () => {
        const agent = await createAgent();
        const vaultAddress = agent.vaultAddress;
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmount), ownerAddress);
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
        await mintAndDepositVaultCollateralToOwner(context, agent2, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(agent2.vaultAddress, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(agent2.vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(agent2.vaultAddress);
        await botCliCommands.closeVault(agent2.vaultAddress);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent2.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
        expect(agentEnt2.exitAvailableAllowedAtTimestamp.gtn(0)).to.be.true;
    });

    it("Should run command 'updateAgentSetting'", async () => {
        const agent = await createAgent();
        const settingName = "feeBIPS";
        const settingValue = "1100";
        await botCliCommands.updateAgentSetting(agent.vaultAddress, settingName, settingValue);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.agentSettingUpdateValidAtTimestamp.gtn(0)).to.be.true;
        expect(agentEnt.agentSettingUpdateValidAtName).to.eq(settingName);
    });

    it("Should get pool fees balance'", async () => {
        const agent = await createAgent();
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmount), ownerAddress);
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
        const fees = await botCliCommands.poolFeesBalance(agent.vaultAddress);
        expect(fees.gtn(0)).to.be.true;
    });

    it("Should withdraw pool fees", async () => {
        const agent = await createAgent();
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmount), ownerAddress);
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
        const amount = await botCliCommands.poolFeesBalance(agent.vaultAddress);
        await botCliCommands.withdrawPoolFees(agent.vaultAddress, (amount.divn(2)).toString());
        const amountAfter = await botCliCommands.poolFeesBalance(agent.vaultAddress);
        expect(amount.gt(amountAfter)).to.be.true;
    });

    it("Should run command 'announceUnderlyingWithdrawal' and 'cancelUnderlyingWithdrawal'", async () => {
        const spyAnnounce = spy.on(botCliCommands, "announceUnderlyingWithdrawal");
        const agent = await createAgent();
        await botCliCommands.announceUnderlyingWithdrawal(agent.vaultAddress);
        const agentEntAnnounce = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntAnnounce.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        expect(spyAnnounce).to.be.called.once;
        //  not enough time passed
        await botCliCommands.cancelUnderlyingWithdrawal(agent.vaultAddress);
        const agentEntCancelTooSoon = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntCancelTooSoon.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        // time passed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await botCliCommands.cancelUnderlyingWithdrawal(agent.vaultAddress);
        const agentEntCancel = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntCancel.underlyingWithdrawalAnnouncedAtTimestamp.eq(BN_ZERO)).to.be.true;
    });

    it("Should run command 'announceUnderlyingWithdrawal' - already active withdrawals", async () => {
        const agent = await createAgent();
        await botCliCommands.announceUnderlyingWithdrawal(agent.vaultAddress);
        const agentEntAnnounce = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntAnnounce.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        const spyConsole = spy.on(console, "log");
        await botCliCommands.announceUnderlyingWithdrawal(agent.vaultAddress);
        expect(spyConsole).to.be.called.once
    });

    it("Should run command 'cancelUnderlyingWithdrawal' - no active withdrawals", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.cancelUnderlyingWithdrawal(agent.vaultAddress);
        expect(spyConsole).to.be.called.once;
    });

    it("Should run command 'performUnderlyingWithdrawal'", async () => {
        const agent = await createAgent();
        const paymentReference = await botCliCommands.announceUnderlyingWithdrawal(agent.vaultAddress);
        const amountToWithdraw = 100;
        const txHash = await botCliCommands.performUnderlyingWithdrawal(agent.vaultAddress, amountToWithdraw.toString(), "SomeRandomUnderlyingAddress", paymentReference!);
        expect(txHash).to.not.be.undefined;
    });

    it("Should run command 'confirmUnderlyingWithdrawal'", async () => {
        const agent = await createAgent();
        const paymentReference = await botCliCommands.announceUnderlyingWithdrawal(agent.vaultAddress);
        const agentEntAnnounce = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntAnnounce.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        const amountToWithdraw = 100;
        const txHash = await botCliCommands.performUnderlyingWithdrawal(agent.vaultAddress, amountToWithdraw.toString(), "SomeRandomUnderlyingAddress", paymentReference!);
        chain.mine(chain.finalizationBlocks + 1);
        //  not enough time passed
        await botCliCommands.confirmUnderlyingWithdrawal(agent.vaultAddress, txHash);
        const agentEntConfirmToSoon = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntConfirmToSoon.underlyingWithdrawalAnnouncedAtTimestamp.gt(BN_ZERO)).to.be.true;
        expect(agentEntConfirmToSoon.underlyingWithdrawalConfirmTransaction).to.eq(txHash);
        // time passed
        await time.increase((await context.assetManager.getSettings()).confirmationByOthersAfterSeconds);
        await botCliCommands.confirmUnderlyingWithdrawal(agent.vaultAddress, txHash);
        const agentEntConfirm = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agent.vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEntConfirm.underlyingWithdrawalAnnouncedAtTimestamp.eq(BN_ZERO)).to.be.true;
        expect(agentEntConfirm.underlyingWithdrawalConfirmTransaction).to.eq("");
    });

    it("Should run command 'confirmUnderlyingWithdrawal' - no active withdrawals", async () => {
        const agent = await createAgent();
        const spyConsole = spy.on(console, "log");
        await botCliCommands.confirmUnderlyingWithdrawal(agent.vaultAddress, "txHash");
        expect(spyConsole).to.be.called.once;
    });

    it("Should run command 'listActiveAgents'", async () => {
        await createAgent();
        const spyLog = spy.on(console, "log");
        await botCliCommands.listActiveAgents();
        expect(spyLog).to.be.called.gt(0);
    });

    it("Should not initialize bot cli commands - missing arguments", async () => {
        const runConfigFile1 = "./test-hardhat/test-utils/run-config-tests/run-config-missing-defaultAgentSettingsPath.json";
        const runConfigFile2 = "./test-hardhat/test-utils/run-config-tests/run-config-missing-ormOptions.json";
        botCliCommands = new BotCliCommands();
        expect(botCliCommands.botConfig).to.be.undefined;
        expect(botCliCommands.context).to.be.undefined;
        expect(botCliCommands.ownerAddress).to.be.undefined;
        await expect(botCliCommands.initEnvironment(runConfigFile1)).to.eventually.be.rejectedWith("Missing defaultAgentSettingsPath or ormOptions in config").and.be.an.instanceOf(Error);
        await expect(botCliCommands.initEnvironment(runConfigFile2)).to.eventually.be.rejectedWith("Missing defaultAgentSettingsPath or ormOptions in config").and.be.an.instanceOf(Error);
    });

    it("Should delegate and undelegate", async () => {
        const agent = await createAgent();
        await mintAndDepositVaultCollateralToOwner(context, agent, toBN(depositAmount), ownerAddress);
        await botCliCommands.buyCollateralPoolTokens(agent.vaultAddress, depositAmount);
        const del1 = accounts[101];
        const del2 = accounts[102];
        const del1Amount = "3000";
        const del2Amount = "5000";
        await botCliCommands.delegatePoolCollateral(agent.vaultAddress, del1, del1Amount);
        const delegations1 = await botCliCommands.context.wNat.delegatesOf(agent.collateralPool.address) as any;
        expect(delegations1._delegateAddresses[0]).to.eq(del1);
        expect(delegations1._bips[0].toString()).to.eq(del1Amount);
        const delegations2 = await botCliCommands.context.wNat.delegatesOf(agent.collateralPool.address) as any;
        expect(delegations2._delegateAddresses[0]).to.eq(del2);
        expect(delegations2._bips[0].toString()).to.eq(del2Amount);
        await botCliCommands.undelegatePoolCollateral(agent.vaultAddress);
        const { _delegateAddresses } = await botCliCommands.context.wNat.delegatesOf(agent.collateralPool.address) as any;
        expect(_delegateAddresses.length).to.eq(0);
    });

});
