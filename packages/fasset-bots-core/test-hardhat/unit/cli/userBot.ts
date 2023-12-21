import { assert, expect, spy, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import spies from "chai-spies";
import { UserBot } from "../../../src/actors/UserBot";
import { ORM } from "../../../src/config/orm";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { MockChain, MockChainWallet } from "../../../src/mock/MockChain";
import { MockIndexer } from "../../../src/mock/MockIndexer";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";
import { SourceId } from "../../../src/underlying-chain/SourceId";
import { ZERO_ADDRESS, checkedCast, sleep, toBN, toBNExp } from "../../../src/utils/helpers";
import { artifacts, web3 } from "../../../src/utils/web3";
import { testChainInfo, testNativeChainInfo } from "../../../test/test-utils/TestChainInfo";
import { createTestOrmOptions } from "../../../test/test-utils/test-bot-config";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { createTestAgentBotAndMakeAvailable, createTestMinter, createTestRedeemer } from "../../test-utils/helpers";
import { time } from "@openzeppelin/test-helpers";
import { latestBlockTimestamp } from "../../../src/utils/web3helpers";
import { Minter } from "../../../src/mock/Minter";
import { existsSync } from "fs";
import { AgentBot } from "../../../src/actors/AgentBot";
import { AgentRedemptionState } from "../../../src/entities/agent";
import { Redeemer } from "../../../src/mock/Redeemer";
use(chaiAsPromised);
use(spies);
import fs from "fs";
import path from "path";
import { MockNotifier } from "../../../src/mock/MockNotifier";

const IERC20 = artifacts.require("IERC20");

const StateConnector = artifacts.require("StateConnectorMock");
const userUnderlyingAddress = "userUnderlyingAddress";

interface MintData {
    type: "mint";
    requestId: string;
    transactionHash: string;
    paymentAddress: string;
    executorAddress: string;
    createdAt: string;
}
interface RedeemData {
    type: "redeem";
    requestId: string;
    amountUBA: string;
    paymentReference: string;
    firstUnderlyingBlock: string;
    lastUnderlyingBlock: string;
    lastUnderlyingTimestamp: string;
    executorAddress: string;
    createdAt: string;
}

describe("UserBot cli commands unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let userBot: UserBot;
    let chain: MockChain;
    let agentBot: AgentBot;
    let minter: Minter;
    let redeemer: Redeemer;

    before(async () => {
        UserBot.userDataDir = "./test-data";
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", type: "sqlite" }));
        // accounts
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
    });

    beforeEach(async () => {
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        // chain tunning
        chain.finalizationBlocks = 0;
        chain.secondsPerBlock = 1;
        // user bot
        userBot = new UserBot();
        userBot.context = context;
        userBot.nativeAddress = minterAddress;
        userBot.underlyingAddress = userUnderlyingAddress;
        const chainId = SourceId.testXRP;
        userBot.fassetConfig = {
            chainInfo: {
                chainId: chainId,
                name: "Ripple",
                symbol: "XRP",
                decimals: 6,
                amgDecimals: 0,
                requireEOAProof: false,
            },
            wallet: new MockChainWallet(chain),
            blockchainIndexerClient: new MockIndexer("", chainId, chain),
            stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainId]: chain }, "auto"),
            assetManager: "",
            fAssetSymbol: "TESTHHSYM",
        };
        userBot.botConfig = {
            rpcUrl: "",
            loopDelay: 0,
            fAssets: [userBot.fassetConfig],
            nativeChainInfo: testNativeChainInfo,
            orm: orm,
            notifier: new MockNotifier(),
            addressUpdater: "",
        };
        agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress);
        minter = await createTestMinter(context, minterAddress, chain, userUnderlyingAddress);
        redeemer = await createTestRedeemer(context, minterAddress, userUnderlyingAddress);
    });

    afterEach(function () {
        spy.restore(console);
    });

    after(function () {
        // clean up -  delete residual redeem files
        const fileList: string[] = [];
        const dir = `./${UserBot.userDataDir}/${userBot.fassetConfig.fAssetSymbol}-redeem/`;
        fs.readdirSync(dir).forEach((file) => {
            const fullPath = path.join(dir, file);
            fileList.push(fullPath);
        });
        fileList.filter((file) => path.extname(file) === ".json");
        for (const file of fileList) {
            fs.unlinkSync(file);
        }
    });

    it("Should update underlying block", async () => {
        const blockBefore = await context.assetManager.currentUnderlyingBlock();
        chain.mine(10);
        await userBot.updateUnderlyingTime();
        const blockAfter = await context.assetManager.currentUnderlyingBlock();
        expect(blockAfter[0].gt(blockBefore[0])).to.be.true;
        expect(blockAfter[1].gt(blockBefore[1])).to.be.true;
    });

    it("Should mint and redeem", async () => {
        const deposit = toBNExp(1_000_000, 6);
        chain.mint(userBot.underlyingAddress, deposit);
        const agentInfoBeforeMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        await userBot.mint(agentBot.agent.vaultAddress, 5);
        const agentInfoAfterMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfterMint.freePoolCollateralNATWei).lt(toBN(agentInfoBeforeMint.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfterMint.freeVaultCollateralWei).lt(toBN(agentInfoBeforeMint.freeVaultCollateralWei)));
        await userBot.redeem(1, ZERO_ADDRESS);
        const agentInfoAfterRedeem = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfterMint.freePoolCollateralNATWei).lt(toBN(agentInfoAfterRedeem.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfterMint.freeVaultCollateralWei).lt(toBN(agentInfoAfterRedeem.freeVaultCollateralWei)));
        await userBot.redeem(10, ZERO_ADDRESS);
        const agentInfoAfterRedeem2 = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfterMint.freePoolCollateralNATWei).lt(toBN(agentInfoAfterRedeem2.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfterMint.freeVaultCollateralWei).lt(toBN(agentInfoAfterRedeem2.freeVaultCollateralWei)));
    });

    it("Should mint and redeem and wait for redemption to be resolved", async () => {
        const deposit = toBNExp(1_000_000, 6);
        chain.mint(userBot.underlyingAddress, deposit);
        const agentInfoBeforeMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        await userBot.mint(agentBot.agent.vaultAddress, 2);
        const agentInfoAfterMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfterMint.freePoolCollateralNATWei).lt(toBN(agentInfoBeforeMint.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfterMint.freeVaultCollateralWei).lt(toBN(agentInfoBeforeMint.freeVaultCollateralWei)));
        const [reqs] = await redeemer.requestRedemption(2);
        const rdReq = reqs[0];
        const data: RedeemData = {
            type: "redeem",
            requestId: String(rdReq.requestId),
            amountUBA: String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))),
            paymentReference: rdReq.paymentReference,
            firstUnderlyingBlock: String(rdReq.firstUnderlyingBlock),
            lastUnderlyingBlock: String(rdReq.lastUnderlyingBlock),
            lastUnderlyingTimestamp: String(rdReq.lastUnderlyingTimestamp),
            executorAddress: ZERO_ADDRESS,
            createdAt: userBot.timestampToDateString(await latestBlockTimestamp()),
        };
        userBot.writeState(data);
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }
        await userBot.listRedemptions();
        const agentInfoAfterRedeem = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfterMint.freePoolCollateralNATWei).lt(toBN(agentInfoAfterRedeem.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfterMint.freeVaultCollateralWei).lt(toBN(agentInfoAfterRedeem.freeVaultCollateralWei)));
        userBot.deleteState(data);
    });

    it("Should mint and defaulted redemption", async () => {
        // vaultCollateralToken
        const vaultCollateralToken = await IERC20.at((await agentBot.agent.getVaultCollateral()).token);
        // mint
        const deposit = toBNExp(1_000_000, 6);
        chain.mint(userBot.underlyingAddress, deposit);
        const agentInfoBeforeMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        await userBot.mint(agentBot.agent.vaultAddress, 1);
        const agentInfoAfterMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfterMint.freePoolCollateralNATWei).lt(toBN(agentInfoBeforeMint.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfterMint.freeVaultCollateralWei).lt(toBN(agentInfoBeforeMint.freeVaultCollateralWei)));
        // request redemption
        const redeemer = await createTestRedeemer(context, userBot.nativeAddress, userUnderlyingAddress);
        const [rdReqs] = await redeemer.requestRedemption(1);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // list and save redemptions
        const data: RedeemData = {
            type: "redeem",
            requestId: String(rdReq.requestId),
            amountUBA: String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))),
            paymentReference: rdReq.paymentReference,
            firstUnderlyingBlock: String(rdReq.firstUnderlyingBlock),
            lastUnderlyingBlock: String(rdReq.lastUnderlyingBlock),
            lastUnderlyingTimestamp: String(rdReq.lastUnderlyingTimestamp),
            executorAddress: ZERO_ADDRESS,
            createdAt: userBot.timestampToDateString(await latestBlockTimestamp()),
        };
        userBot.writeState(data);
        await userBot.listRedemptions();
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        await userBot.listRedemptions();
        // redeemer requests non-payment proof
        // redeemer triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await vaultCollateralToken.balanceOf(redeemer.address);
        const startBalanceAgent = await vaultCollateralToken.balanceOf(agentBot.agent.vaultAddress);
        const amount = toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA));
        // redemption default - invalid payment reference
        await expect(
            userBot.redemptionDefault(amount, userBot.nativeAddress, rdReq.firstUnderlyingBlock, rdReq.lastUnderlyingBlock, rdReq.lastUnderlyingTimestamp, rdReq.executor)
        )
            .to.eventually.be.rejectedWith("Invalid payment reference")
            .and.be.an.instanceOf(Error);
        // redemption default
        await userBot.savedRedemptionDefault(rdReq.requestId);
        const endBalanceRedeemer = await vaultCollateralToken.balanceOf(redeemer.address);
        const endBalanceAgent = await vaultCollateralToken.balanceOf(agentBot.agent.vaultAddress);
        expect(endBalanceRedeemer.gt(startBalanceRedeemer)).to.be.true;
        expect(endBalanceAgent.lt(startBalanceAgent)).to.be.true;
    });

    it("Should enter and exit pool", async () => {
        const poolAddress = agentBot.agent.collateralPool.address;
        const amount = toBN(10000000000000000000);
        const enter = await userBot.enterPool(poolAddress, amount);
        expect(enter.tokenHolder).to.eq(userBot.nativeAddress);
        expect(enter.amountNatWei.eq(amount)).to.be.true;
        await time.increase(time.duration.days(1));
        const exit = await userBot.exitPool(poolAddress, amount);
        expect(exit.tokenHolder).to.eq(userBot.nativeAddress);
        expect(exit.receivedNatWei.eq(amount)).to.be.true;
    });

    it("Should write and read state data", async () => {
        const mintData: MintData = {
            type: "mint",
            requestId: "001",
            paymentAddress: "r3RoZkBrbJqivaXs3qugAQDhHHsXboYANy",
            transactionHash: "BA2B34AE1025C7BA4288BD18B4D5A79B3E71A412DB208BB6569FC4369784ED01",
            executorAddress: ZERO_ADDRESS,
            createdAt: "2023-11-24T10:42:03.811Z",
        };
        const redeemData: RedeemData = {
            type: "redeem",
            requestId: "001",
            amountUBA: "9900000000",
            paymentReference: "0x4642505266410002000000000000000000000000000000000000000000000120",
            firstUnderlyingBlock: "0",
            lastUnderlyingBlock: "10",
            lastUnderlyingTimestamp: context.blockchainIndexer.chain.currentTimestamp().toString(),
            executorAddress: ZERO_ADDRESS,
            createdAt: new Date().toISOString(),
        };
        userBot.writeState(mintData);
        userBot.writeState(redeemData);
        const readM = userBot.readState("mint", mintData.requestId);
        expect(mintData.type).to.eq(readM.type);
        expect(mintData.requestId).to.eq(readM.requestId);
        expect(mintData.transactionHash).to.eq(readM.transactionHash);
        expect(mintData.paymentAddress).to.eq(readM.paymentAddress);
        expect(mintData.createdAt).to.eq(readM.createdAt);
        const readR = userBot.readState("redeem", redeemData.requestId);
        expect(redeemData.type).to.eq(readR.type);
        expect(redeemData.requestId).to.eq(readR.requestId);
        expect(redeemData.amountUBA).to.eq(readR.amountUBA);
        expect(redeemData.paymentReference).to.eq(readR.paymentReference);
        expect(redeemData.firstUnderlyingBlock).to.eq(readR.firstUnderlyingBlock);
        expect(redeemData.lastUnderlyingBlock).to.eq(readR.lastUnderlyingBlock);
        expect(redeemData.lastUnderlyingTimestamp).to.eq(readR.lastUnderlyingTimestamp);
        expect(redeemData.createdAt).to.eq(readR.createdAt);
        await userBot.listMintings();
        await userBot.listRedemptions();
        userBot.deleteState(mintData);
        userBot.deleteState(redeemData);
    });

    it("Should proof and execute saved minting", async () => {
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 1);
        const txHash = await minter.performMintingPayment(crt);
        const timestamp = await latestBlockTimestamp();
        const mintData: MintData = {
            type: "mint",
            requestId: String(crt.collateralReservationId),
            paymentAddress: crt.paymentAddress,
            transactionHash: txHash,
            executorAddress: ZERO_ADDRESS,
            createdAt: userBot.timestampToDateString(timestamp),
        };
        userBot.writeState(mintData);
        const newFilename = `./${UserBot.userDataDir}/${userBot.fassetConfig.fAssetSymbol}-mint/${mintData.requestId}.json`;
        const existBefore = existsSync(newFilename);
        expect(existBefore).to.be.true;
        await userBot.listMintings();
        await userBot.proveAndExecuteSavedMinting(mintData.requestId);
        const existAfter = existsSync(newFilename);
        expect(existAfter).to.be.false;
    });

    it("Should reserve collateral", async () => {
        const deposit = toBNExp(1_000_000, 6);
        chain.mint(userBot.underlyingAddress, deposit);
        const userBalanceBefore = await context.blockchainIndexer.chain.getBalance(userBot.underlyingAddress);
        const agentInfoBefore = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        const  resId = await userBot.reserveCollateral(agentBot.agent.vaultAddress, 5, ZERO_ADDRESS, undefined);
        const userBalanceAfter = await context.blockchainIndexer.chain.getBalance(userBot.underlyingAddress);
        const agentInfoAfter = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfter.freePoolCollateralNATWei).lt(toBN(agentInfoBefore.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfter.freeVaultCollateralWei).lt(toBN(agentInfoBefore.freeVaultCollateralWei)));
        expect(toBN(userBalanceAfter).lt(toBN(userBalanceBefore)));
        const state = userBot.readState("mint", resId);
        expect(state.executorAddress).to.eq(ZERO_ADDRESS);
        userBot.deleteState(state);
});

    it("Should reserve collateral with executor", async () => {
        const executor = accounts[101];
        const fee = toBNExp(50, 6);
        const deposit = toBNExp(1_000_000, 6);
        chain.mint(userBot.underlyingAddress, deposit);
        const userBalanceBefore = await context.blockchainIndexer.chain.getBalance(userBot.underlyingAddress);
        const agentInfoBefore = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        const resId = await userBot.reserveCollateral(agentBot.agent.vaultAddress, 5, executor, fee);
        const userBalanceAfter = await context.blockchainIndexer.chain.getBalance(userBot.underlyingAddress);
        const agentInfoAfter = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfter.freePoolCollateralNATWei).lt(toBN(agentInfoBefore.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfter.freeVaultCollateralWei).lt(toBN(agentInfoBefore.freeVaultCollateralWei)));
        expect(toBN(userBalanceAfter).lt(toBN(userBalanceBefore)));
        const state = userBot.readState("mint", resId);
        expect(state.executorAddress).to.eq(executor);
        userBot.deleteState(state);
    });

    it("Should mint and defaulted redemption with executor", async () => {
        const executor = accounts[101];
        const fee = toBNExp(50, 6);
        // vaultCollateralToken
        const vaultCollateralToken = await IERC20.at((await agentBot.agent.getVaultCollateral()).token);
        const deposit = toBNExp(1_000_000, 6);
        chain.mint(userBot.underlyingAddress, deposit);
        const agentInfoBeforeMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        await userBot.mint(agentBot.agent.vaultAddress, 1);
        const agentInfoAfterMint = await context.assetManager.getAgentInfo(agentBot.agent.vaultAddress);
        expect(toBN(agentInfoAfterMint.freePoolCollateralNATWei).lt(toBN(agentInfoBeforeMint.freePoolCollateralNATWei)));
        expect(toBN(agentInfoAfterMint.freeVaultCollateralWei).lt(toBN(agentInfoBeforeMint.freeVaultCollateralWei)));
        // redeemer and requests
        const redeemer = await createTestRedeemer(context, userBot.nativeAddress, userUnderlyingAddress);
        const [rdReqs] = await redeemer.requestRedemption(1, executor, fee);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // list and save redemptions
        const data: RedeemData = {
            type: "redeem",
            requestId: String(rdReq.requestId),
            amountUBA: String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))),
            paymentReference: rdReq.paymentReference,
            firstUnderlyingBlock: String(rdReq.firstUnderlyingBlock),
            lastUnderlyingBlock: String(rdReq.lastUnderlyingBlock),
            lastUnderlyingTimestamp: String(rdReq.lastUnderlyingTimestamp),
            executorAddress: String(rdReq.executor),
            createdAt: userBot.timestampToDateString(await latestBlockTimestamp()),
        };
        userBot.writeState(data);
        await userBot.listRedemptions();
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        await userBot.listRedemptions();
        // redeemer requests non-payment proof
        // redeemer triggers payment default and gets paid in collateral with extra
        const startBalanceRedeemer = await vaultCollateralToken.balanceOf(redeemer.address);
        const startBalanceAgent = await vaultCollateralToken.balanceOf(agentBot.agent.vaultAddress);
        const amount = toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA));
        const state = userBot.readState("redeem", rdReq.requestId);
        expect(state.executorAddress).to.eq(executor);
        // redemption default - invalid payment reference
        await expect(
            userBot.redemptionDefault(amount, userBot.nativeAddress, rdReq.firstUnderlyingBlock, rdReq.lastUnderlyingBlock, rdReq.lastUnderlyingTimestamp, rdReq.executor)
        )
            .to.eventually.be.rejectedWith("Invalid payment reference")
            .and.be.an.instanceOf(Error);
        // redemption default
        await userBot.savedRedemptionDefault(rdReq.requestId);
        const endBalanceRedeemer = await vaultCollateralToken.balanceOf(redeemer.address);
        const endBalanceAgent = await vaultCollateralToken.balanceOf(agentBot.agent.vaultAddress);
        expect(endBalanceRedeemer.gt(startBalanceRedeemer)).to.be.true;
        expect(endBalanceAgent.lt(startBalanceAgent)).to.be.true;
    });

});