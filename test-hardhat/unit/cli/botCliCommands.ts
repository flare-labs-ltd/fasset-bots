import { ORM } from "../../../src/config/orm";
import { checkedCast, toBN, toBNExp, toStringExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
import { Minter } from "../../../src/mock/Minter";
import { MockChain } from "../../../src/mock/MockChain";
import { AgentEntity } from "../../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const minterUnderlying: string = "MINTER_ADDRESS";
const depositAmount = toStringExp(100_000_000, 18);
const withdrawAmount = toStringExp(100_000_000, 4);
const feeBIPS = 500;
const minCR = 30000;

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
        botCliCommands.orm = orm;
        botCliCommands.context = context;
        botCliCommands.ownerAddress = ownerAddress;
    })

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

});