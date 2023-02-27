import { ORM } from "../../../src/config/orm";
import { checkedCast, toBNExp, toStringExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/test-asset-context";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
import { toBN } from "@flarenetwork/mcc";
import { Minter } from "../../../src/mock/Minter";
import { MockChain } from "../../../src/mock/MockChain";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const minterUnderlying: string = "MINTER_ADDRESS";

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
        const depositAmount = toStringExp(100_000_000, 18);
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateral = await context.wnat.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
    });

    it("Should create enter and exit available list", async () => {
        const depositAmount = toStringExp(100_000_000, 18);
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateral = await context.wnat.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
        const agenInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agenInfoBefore.publiclyAvailable).to.be.false;
        await botCliCommands.enterAvailableList(vaultAddress, "500", "30000");
        const agenInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agenInfoMiddle.publiclyAvailable).to.be.true;
        await botCliCommands.exitAvailableList(vaultAddress);
        const agenInfoAfter = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agenInfoAfter.publiclyAvailable).to.be.false;
    });

    it.skip("Should withdraw from agent vault", async () => {
        const depositAmount = toStringExp(100_000_000, 18);
        const withdrawAmount = toStringExp(100_000_000, 4);
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        const collateralBefore = await context.wnat.balanceOf(vaultAddress);
        expect(collateralBefore.toString()).to.eq(depositAmount);
        await botCliCommands.withdrawFromVault(vaultAddress, withdrawAmount);
        const collateralAfter = await context.wnat.balanceOf(vaultAddress);
        expect(collateralAfter.toString()).to.eq(toBN(depositAmount).sub(toBN(withdrawAmount)).toString());
    });

    it("Should self close", async () => {
        const vaultAddress = await botCliCommands.createAgentVault();
        const depositAmount = toStringExp(100_000_000, 18);
        await botCliCommands.depositToVault(vaultAddress, depositAmount);
        await botCliCommands.enterAvailableList(vaultAddress, "500", "30000");
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

});