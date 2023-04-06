/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ORM } from "../../../src/config/orm";
import { BN_ZERO, checkedCast, toBN, toStringExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";
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
import { createMinter, disableMccTraceManager, mintAndDepositClass1ToOwner } from "../../test-utils/helpers";
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
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
    });

    it("Should deposit to agent vault", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress!, depositAmount);
        const collateral = await class1TokenContract.balanceOf(vaultAddress!);
        expect(collateral.toString()).to.eq(depositAmount);
    });

    it("Should buy collateral pool tokens", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.buyCollateralPoolTokens(vaultAddress!, depositAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        const collateral = await context.wNat.balanceOf(agentEnt.collateralPoolAddress);
        expect(collateral.toString()).to.eq(depositAmount);
    });

    it("Should enter and announce exit available list", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        // deposit to vault
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress!, depositAmount);
        const collateral = await class1TokenContract.balanceOf(vaultAddress!);
        expect(collateral.toString()).to.eq(depositAmount);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress!);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // buy collateral pool tokens
        await botCliCommands.buyCollateralPoolTokens(vaultAddress!, depositAmount);
        // enter available
        await botCliCommands.enterAvailableList(vaultAddress!);
        const agentInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress!);
        expect(agentInfoMiddle.publiclyAvailable).to.be.true;
        // exit enter available
        await botCliCommands.announceExitAvailableList(vaultAddress!);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.exitAvailableAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    });

    it("Should deposit and withdraw from agent vault", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress!, depositAmount);
        const collateralBefore = await class1TokenContract.balanceOf(vaultAddress!);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.withdrawFromVault(vaultAddress!, withdrawAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.withdrawalAllowedAtAmount.eq(toBN(withdrawAmount))).to.be.true;
        expect(agentEnt.withdrawalAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    })

    it("Should self close", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress!, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress!, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress!);
        // execute minting
        const minter = await createMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(vaultAddress!, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(ownerAddress, fBalance, { from: minter.address });
        await botCliCommands.selfClose(vaultAddress!, fBalance.divn(2).toString());
        const fBalanceAfter = await context.fAsset.balanceOf(ownerAddress);
        expect(fBalanceAfter.toString()).to.eq(fBalance.divn(2).toString());
    });

    it("Should close vault", async () => {
        const vaultAddress1 = await botCliCommands.createAgentVault();
        await botCliCommands.closeVault(vaultAddress1!);
        const agentEnt1 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress1 } as FilterQuery<AgentEntity>);
        expect(agentEnt1.waitingForDestructionCleanUp).to.be.true;

        const vaultAddress2 = await botCliCommands.createAgentVault();
        await mintAndDepositClass1ToOwner(context, vaultAddress2!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress2!, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress2!, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress2!);
        await botCliCommands.closeVault(vaultAddress2!);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress2 } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
    });

    it("Should list usage commands", async () => {
        const spyLog = spy.on(console, "log");
        listUsageAndCommands();
        await botCliCommands.run([]);
        await botCliCommands.run(["", "", "unknownCommand"]);
        expect(spyLog).to.be.called.exactly(33);
    });

    it("Should run command 'create'", async () => {
        const spyAgent = spy.on(botCliCommands, "createAgentVault");
        await botCliCommands.run(["", "", "create"]);
        expect(spyAgent).to.be.called.once;

    });

    it("Should run command 'deposit'", async () => {
        const spyDeposit = spy.on(botCliCommands, "depositToVault");
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.run(["", "", "deposit", vaultAddress!, depositAmount]);
        expect(spyDeposit).to.be.called.once;
    });

    it("Should not run command 'deposit' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "deposit"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run commands 'enter' and 'exit'", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        // deposit to vault
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress!, depositAmount);
        await botCliCommands.depositToVault(vaultAddress!, depositAmount);
        const collateral = await class1TokenContract.balanceOf(vaultAddress!);
        expect(collateral.toString()).to.eq(depositAmount);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress!);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        // enter available
        await botCliCommands.run(["", "", "enter", vaultAddress!]);
        const agentInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress!);
        expect(agentInfoMiddle.publiclyAvailable).to.be.true;
        // announce exit
        await botCliCommands.run(["", "", "exit", vaultAddress!]);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
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

    it("Should run commands 'deposit' and 'withdraw", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        const class1TokenContract = await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.run(["", "", "deposit", vaultAddress!, depositAmount]);
        const collateralBefore = await class1TokenContract.balanceOf(vaultAddress!);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.run(["", "", "withdraw", vaultAddress!, withdrawAmount]);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.withdrawalAllowedAtAmount.eq(toBN(withdrawAmount))).to.be.true;
        expect(agentEnt.withdrawalAllowedAtTimestamp.gt(BN_ZERO)).to.be.true;
    });

    it("Should not run command 'deposit' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "deposit"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should not run command 'withdraw' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "withdraw"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'selfClose'", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        await mintAndDepositClass1ToOwner(context, vaultAddress!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress!, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress!, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress!);
        // execute minting
        const minter = await createMinter(context, minterAddress, chain);
        const crt = await minter.reserveCollateral(vaultAddress!, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(ownerAddress, fBalance, { from: minter.address });
        await botCliCommands.run(["", "", "selfClose", vaultAddress!, fBalance.divn(2).toString()]);
        const fBalanceAfter = await context.fAsset.balanceOf(ownerAddress);
        expect(fBalanceAfter.toString()).to.eq(fBalance.divn(2).toString());
    });

    it("Should not run command 'selfClose' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "selfClose"]);
        expect(spyLog).to.be.called.once;
    });

    it("Should run command 'close'", async () => {
        const vaultAddress1 = await botCliCommands.createAgentVault();
        await botCliCommands.run(["", "", "close", vaultAddress1!]);
        const agentEnt1 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress1 } as FilterQuery<AgentEntity>);
        expect(agentEnt1.waitingForDestructionCleanUp).to.be.true;

        const vaultAddress2 = await botCliCommands.createAgentVault();
        await mintAndDepositClass1ToOwner(context, vaultAddress2!, toBN(depositAmount), ownerAddress);
        await botCliCommands.depositToVault(vaultAddress2!, depositAmount);
        await botCliCommands.buyCollateralPoolTokens(vaultAddress2!, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress2!);
        await botCliCommands.run(["", "", "close", vaultAddress2!]);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress2 } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
    });

    it("Should not run command 'close' - missing inputs", async () => {
        const spyLog = spy.on(console, "log");
        await botCliCommands.run(["", "", "close"]);
        expect(spyLog).to.be.called.once;
    });

});

