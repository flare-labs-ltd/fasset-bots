import { ORM } from "../../../src/config/orm";
import { checkedCast, toBN, toBNExp, toStringExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { BotCliCommands, listUsageAndCommands } from "../../../src/cli/BotCliCommands";
import { Minter } from "../../../src/mock/Minter";
import { MockChain, MockChainWallet } from "../../../src/mock/MockChain";
import { AgentEntity } from "../../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core";
import { Notifier } from "../../../src/utils/Notifier";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";
import { artifacts } from "../../../src/utils/artifacts";
import { MockIndexer } from "../../../src/mock/MockIndexer";
import { createWalletClient } from "../../../src/config/BotConfig";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chai = require('chai');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;
// eslint-disable-next-line @typescript-eslint/no-var-requires
chai.use(require("chai-as-promised"));

const minterUnderlying: string = "MINTER_ADDRESS";
const depositAmount = toStringExp(100_000_000, 18);
const withdrawAmount = toStringExp(100_000_000, 4);
const feeBIPS = 500;
const minCR = 30000;
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
                blockChainIndexerClient: new MockIndexer("", chainId, createWalletClient(chainId, true), chain),
                assetManager: "",
            }],
            nativeChainInfo: {
                finalizationBlocks: 0,
                readLogsChunkSize: 0,
            },
            orm: orm,
            notifier: new Notifier(),
            addressUpdater: ""
        }
    });

    afterEach(function () {
        chai.spy.restore(console);
    });

    it("Should create agent vault", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
    });

    it("Should deposit to agent vault,", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateral = await context.wnat.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
    });

    it("Should enter and exit available list", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateral = await context.wnat.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        await botCliCommands.enterAvailableList(vaultAddress, feeBIPS.toString(), minCR.toString());
        const agentInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoMiddle.publiclyAvailable).to.be.true;
        await botCliCommands.exitAvailableList(vaultAddress);
        const agentInfoAfter = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoAfter.publiclyAvailable).to.be.false;
    });

    it("Should deposit and withdraw from agent vault", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateralBefore = await context.wnat.balanceOf(vaultAddress);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.withdrawFromVault(vaultAddress, withdrawAmount);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.waitingForWithdrawalAmount.eq(toBN(withdrawAmount))).to.be.true;
        expect(agentEnt.waitingForWithdrawalTimestamp).to.gt(0);
    });

    it("Should self close", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress, feeBIPS.toString(), minCR.toString());
        // execute minting
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
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

    it("Should set agent's minimal collateral ratio", async () => {
        const settings = await context.assetManager.getSettings();
        const minCR = toBN(settings.minCollateralRatioBIPS).muln(2).toString();
        const vaultAddress = await botCliCommands.createAgentVault();
        await botCliCommands.setAgentMinCR(vaultAddress, minCR);
        const agentInfo = await context.assetManager.getAgentInfo(vaultAddress);
        expect(minCR).to.eq(agentInfo.agentMinCollateralRatioBIPS.toString());
    });

    it("Should close vault", async () => {
        const vaultAddress1 = await botCliCommands.createAgentVault();
        await botCliCommands.closeVault(vaultAddress1);
        const agentEnt1 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress1 } as FilterQuery<AgentEntity>);
        expect(agentEnt1.waitingForDestructionCleanUp).to.be.true;

        const vaultAddress2 = await botCliCommands.createAgentVault();
        await botCliCommands.depositToVault(vaultAddress2, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress2, feeBIPS.toString(), minCR.toString());
        await botCliCommands.closeVault(vaultAddress2);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress2 } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
    });

    it("Should list usage commands", async () => {
        const spy = chai.spy.on(console, "log");
        listUsageAndCommands();
        await botCliCommands.run([]);
        await botCliCommands.run(["", "", "unknownCommand"]);
        expect(spy).to.be.called.exactly(30);
    });

    it("Should run command 'create'", async () => {
        const spy = chai.spy.on(botCliCommands, "createAgentVault");
        await botCliCommands.run(["", "", "create"]);
        expect(spy).to.be.called.once;

    });

    it("Should run command 'deposit'", async () => {
        const spy = chai.spy.on(botCliCommands, "depositToVault");
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.run(["", "", "deposit", vaultAddress, depositAmount]);
        expect(spy).to.be.called.once;
    });

    it("Should not run command 'deposit' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "deposit"]);
        expect(spy).to.be.called.once;
    });

    it("Should run commands 'enter' and 'exit'", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateral = await context.wnat.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
        const agentInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoBefore.publiclyAvailable).to.be.false;
        await botCliCommands.run(["", "", "enter", vaultAddress, feeBIPS.toString(), minCR.toString()]);
        const agentInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoMiddle.publiclyAvailable).to.be.true;
        await botCliCommands.run(["", "", "exit", vaultAddress]);
        const agentInfoAfter = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agentInfoAfter.publiclyAvailable).to.be.false;

    });

    it("Should not run command 'enter' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "enter"]);
        expect(spy).to.be.called.once;
    });

    it("Should not run command 'exit' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "exit"]);
        expect(spy).to.be.called.once;
    });

    it("Should run command 'setMinCR'", async () => {
        const settings = await context.assetManager.getSettings();
        const minCR = toBN(settings.minCollateralRatioBIPS).muln(2).toString();
        const vaultAddress = await botCliCommands.createAgentVault();
        await botCliCommands.run(["", "", "setMinCR", vaultAddress, minCR.toString()]);
        const agentInfo = await context.assetManager.getAgentInfo(vaultAddress);
        expect(minCR).to.eq(agentInfo.agentMinCollateralRatioBIPS.toString());
    });

    it("Should not run command 'setMinCR' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "setMinCR"]);
        expect(spy).to.be.called.once;
    });

    it("Should run commands 'deposit' and 'withdraw", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.run(["", "", "deposit", vaultAddress, depositAmount]);
        const collateralBefore = await context.wnat.balanceOf(vaultAddress);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.run(["", "", "withdraw", vaultAddress, withdrawAmount]);
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress } as FilterQuery<AgentEntity>);
        expect(agentEnt.waitingForWithdrawalAmount.eq(toBN(withdrawAmount))).to.be.true;
        expect(agentEnt.waitingForWithdrawalTimestamp).to.gt(0);
    });

    it("Should not run command 'deposit' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "deposit"]);
        expect(spy).to.be.called.once;
    });

    it("Should not run command 'withdraw' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "withdraw"]);
        expect(spy).to.be.called.once;
    });

    it("Should run command 'selfClose'", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress, feeBIPS.toString(), minCR.toString());
        // execute minting
        const minter = await Minter.createTest(context, minterAddress, minterUnderlying, toBNExp(10_000, 6)); // lot is 1000 XRP
        const crt = await minter.reserveCollateral(vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(ownerAddress, fBalance, { from: minter.address });
        await botCliCommands.run(["", "", "selfClose", vaultAddress, fBalance.divn(2).toString()]);
        const fBalanceAfter = await context.fAsset.balanceOf(ownerAddress);
        expect(fBalanceAfter.toString()).to.eq(fBalance.divn(2).toString());
    });

    it("Should not run command 'selfClose' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "selfClose"]);
        expect(spy).to.be.called.once;
    });

    it("Should run command 'close'", async () => {
        const vaultAddress1 = await botCliCommands.createAgentVault();
        await botCliCommands.run(["", "", "close", vaultAddress1]);
        const agentEnt1 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress1 } as FilterQuery<AgentEntity>);
        expect(agentEnt1.waitingForDestructionCleanUp).to.be.true;

        const vaultAddress2 = await botCliCommands.createAgentVault();
        await botCliCommands.depositToVault(vaultAddress2, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress2, feeBIPS.toString(), minCR.toString());
        await botCliCommands.run(["", "", "close", vaultAddress2]);
        const agentEnt2 = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: vaultAddress2 } as FilterQuery<AgentEntity>);
        expect(agentEnt2.waitingForDestructionCleanUp).to.be.true;
    });

    it("Should not run command 'close' - missing inputs", async () => {
        const spy = chai.spy.on(console, "log");
        await botCliCommands.run(["", "", "close"]);
        expect(spy).to.be.called.once;
    });

});