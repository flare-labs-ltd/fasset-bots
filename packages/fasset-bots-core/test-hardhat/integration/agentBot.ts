import { FilterQuery } from "@mikro-orm/core";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import { assert, expect, spy, use } from "chai";
import spies from "chai-spies";
import { AgentBot } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { AgentEntity, AgentMinting } from "../../src/entities/agent";
import { AgentStatus, AssetManagerSettings, AvailableAgentInfo } from "../../src/fasset/AssetManagerTypes";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { attestationWindowSeconds, proveAndUpdateUnderlyingBlock } from "../../src/utils/fasset-helpers";
import { BN_ZERO, MAX_BIPS, ZERO_ADDRESS, checkedCast, requireNotNull, toBN, toBNExp } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { AgentOwnerRegistryInstance } from "../../typechain-truffle";
import { FaultyNotifierTransport } from "../test-utils/FaultyNotifierTransport";
import { TestAssetBotContext, createTestAssetContext } from "../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../test-utils/hardhat-test-helpers";
import { QUERY_WINDOW_SECONDS, convertFromUSD5, createCRAndPerformMinting, createCRAndPerformMintingAndRunSteps, createTestAgent, createTestAgentBotAndMakeAvailable, createTestMinter, createTestRedeemer, getAgentStatus, mintVaultCollateralToOwner, updateAgentBotUnderlyingBlockProof } from "../test-utils/helpers";
import { AgentMintingState, AgentRedemptionState } from "../../src/entities/common";
import { PaymentReference } from "../../src/fasset/PaymentReference";
use(spies);

const IERC20 = artifacts.require("IERC20");

describe("Agent bot tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let minterAddress: string;
    let redeemerAddress: string;
    let chain: MockChain;
    let settings: AssetManagerSettings;
    let agentBot: AgentBot;
    let minter: Minter;
    let redeemer: Redeemer;

    const ownerManagementAddress = "0xBcAf5dAA7497dfc21D7C009C555E17E8a2574dE5";
    const ownerManagementPrivateKey = "0x713163204991ba62e8f50f5a29c518484e7fe4a8a35f3b932c986748c1fc0940";

    async function testSetWorkAddress(agentOwnerRegistry: AgentOwnerRegistryInstance, managementAddress: string, managementPrivateKey: string, workAddress: string) {
        const methodAbi = requireNotNull(agentOwnerRegistry.abi.find(it => it.name === "setWorkAddress"));
        const data = web3.eth.abi.encodeFunctionCall(methodAbi, [workAddress]);
        const account = web3.eth.accounts.privateKeyToAccount(managementPrivateKey);
        assert.equal(account.address, managementAddress);
        const signedTx = await web3.eth.accounts.signTransaction({ from: managementAddress, to: agentOwnerRegistry.address, data: data, gas: 100000 }, managementPrivateKey);
        await web3.eth.sendSignedTransaction(requireNotNull(signedTx.rawTransaction));
    }

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerAddress = accounts[3];
        minterAddress = accounts[4];
        redeemerAddress = accounts[5];
    });

    async function initialize() {
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        settings = await context.assetManager.getSettings();
        // create work address
        await web3.eth.sendTransaction({ from: accounts[0], to: ownerManagementAddress, value: toBNExp(1, 18).toString(), gas: 100000 });
        await testSetWorkAddress(context.agentOwnerRegistry, ownerManagementAddress, ownerManagementPrivateKey, ownerAddress);
        //
        agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false);
        minter = await createTestMinter(context, minterAddress, chain);
        redeemer = await createTestRedeemer(context, redeemerAddress);
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        return { orm, context, chain, settings, agentBot, minter, redeemer };
    }

    beforeEach(async () => {
        ({ orm, context, chain, settings, agentBot, minter, redeemer } = await loadFixtureCopyVars(initialize));
    });

    it("Management address should not work for sending from server", async () => {
        await web3.eth.sendTransaction({ from: ownerAddress, to: accounts[0], value: "1", gas: 100000 });
        await expectRevert(web3.eth.sendTransaction({ from: ownerManagementAddress, to: accounts[0], value: "1", gas: 100000 }),
            "unknown account");
    });

    it("Should perform minting", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
        // pay for and execute minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // the minting status should now be 'done'
        orm.em.clear();
        const openMintingsAfter = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(openMintingsAfter.length, 0);
        const mintingAfter = await agentBot.minting.findMinting(orm.em, minting.requestId);
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
    });

    it("Should perform minting and redemption", async () => {
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }
        // redeemer should now have some funds on the underlying chain
        const balance = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance), String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))));
    });

    it("Should not perform minting - minter does not pay", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        assert.equal(mintings[0].state, "started");
        // run it also now to cover else
        await agentBot.handleOpenMintings(orm.em);
        orm.em.clear();
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        assert.equal(mintings[0].state, "started");
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp));
        chain.mine(Number(crt.lastUnderlyingBlock));
        // get time proof
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // handle again
        await agentBot.handleOpenMintings(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedNonPaymentProof'
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        assert.equal(mintings[0].state, AgentMintingState.REQUEST_NON_PAYMENT_PROOF);
        // check if minting is done
        await agentBot.handleOpenMintings(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.minting.findMinting(orm.em, crt.collateralReservationId);
        assert.equal(mintingDone.state, AgentMintingState.DONE);
        // check that executing minting after calling mintingPaymentDefault will revert
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
    });

    it("Should perform minting - minter pays, agent execute minting", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        let mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingStarted = mintings[0];
        assert.equal(mintingStarted.state, AgentMintingState.STARTED);
        // pay for minting
        await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp));
        chain.mine(Number(crt.lastUnderlyingBlock));
        // get time proof
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // handle again
        await agentBot.handleOpenMintings(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedPaymentProof'
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingRequestedNonPaymentProof = mintings[0];
        assert.equal(mintingRequestedNonPaymentProof.state, AgentMintingState.REQUEST_PAYMENT_PROOF);
        // check if minting is done
        await agentBot.handleOpenMintings(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.minting.findMinting(orm.em, crt.collateralReservationId);
        assert.equal(mintingDone.state, AgentMintingState.DONE);
    });

    it("Should perform unstick minting - minter does not pay and time expires in indexer", async () => {
        // create multiple collateral reservations
        const num = 10;
        for (let i = 0; i < num; i++) {
            await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        }
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        // get time proof
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // run step
        await agentBot.runStep(orm.em);
        // check if mintings are done
        orm.em.clear();
        const query = orm.em.createQueryBuilder(AgentMinting);
        const mintings = await query.where({ agentAddress: agentBot.agent.vaultAddress }).andWhere({ state: AgentMintingState.DONE }).getResultList();
        for (const mint of mintings) {
            assert.equal(mint.state, AgentMintingState.DONE);
        }
    });

    it("Should perform unstick minting - minter pays and time expires in indexer", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        // pay for minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        // get time proof
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // run step
        await agentBot.runStep(orm.em);
        // check if minting is done
        orm.em.clear();
        const mintingDone = await agentBot.minting.findMinting(orm.em, crt.collateralReservationId);
        assert.equal(mintingDone.state, AgentMintingState.DONE);
        // check that executing minting after calling unstickMinting will revert
        await expectRevert(minter.executeMinting(crt, txHash), "invalid crt id");
    });

    it("Should delete minting", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const openMintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(openMintings.length, 1);
        const mintingStarted = openMintings[0];
        assert.equal(mintingStarted.state, AgentMintingState.STARTED);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        // manually unstick minting
        const settings = await context.assetManager.getSettings();
        const burnNats = (await agentBot.agent.getPoolCollateralPrice())
            .convertUBAToTokenWei(crt.valueUBA)
            .mul(toBN(settings.vaultCollateralBuyForFlareFactorBIPS))
            .divn(MAX_BIPS);
        const proof = await agentBot.agent.attestationProvider.proveConfirmedBlockHeightExists(await attestationWindowSeconds(context.assetManager));
        await agentBot.agent.assetManager.unstickMinting(proof, crt.collateralReservationId, { from: agentBot.agent.owner.workAddress, value: burnNats ?? BN_ZERO });
        await agentBot.runStep(orm.em);
        // should have an closed minting
        const openMintings2 = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(openMintings2.length, 0);
    });

    it("Should not perform redemption - agent does not pay, time expires on underlying", async () => {
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        context.blockchainIndexer.chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        // agentBot stores redemption
        await agentBot.runStep(orm.em);
        const redemptionStarted = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionStarted.state, AgentRedemptionState.STARTED);
        // agentBot doesn't pay for redemption - expired on underlying
        await agentBot.runStep(orm.em);
        const redemptionNotPaid = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionNotPaid.state, AgentRedemptionState.STARTED);
    });

    it("Should not perform redemption - agent does not pay, time expires in indexer", async () => {
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // redemption started
        await agentBot.handleEvents(orm.em);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        // get time proof
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // run step
        await agentBot.runStep(orm.em);
        // check redemption
        orm.em.clear();
        const redemptionDone = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
    });

    it("Should not perform redemption - agent pays, time expires in indexer", async () => {
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // agent pays
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        const redemptionPaid = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionPaid.state, AgentRedemptionState.PAID);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        // check if redemption is done
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }
        const redemptionDone = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
    });

    it("Should not perform redemption - agent does not confirm, anyone can confirm time expired on underlying", async () => {
        // vaultCollateralToken
        const vaultCollateralType = await agentBot.agent.getVaultCollateral();
        const vaultCollateralToken = await IERC20.at(vaultCollateralType.token);
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // redemption has started and is paid
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionPaid = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
        assert.equal(redemptionPaid.state, AgentRedemptionState.PAID);
        // agent does not confirm payment
        // others can confirm redemption payment after some time
        await time.increase(settings.confirmationByOthersAfterSeconds);
        chain.mine(chain.finalizationBlocks + 1);
        const someAddress = accounts[10];
        const startBalance = await vaultCollateralToken.balanceOf(someAddress);
        const startAgentBalance = await vaultCollateralToken.balanceOf(agentBot.agent.vaultAddress);
        const proof = await context.attestationProvider.provePayment(redemptionPaid.txHash!, agentBot.agent.underlyingAddress, rdReq.paymentAddress);
        await context.assetManager.confirmRedemptionPayment(proof, rdReq.requestId, { from: someAddress });
        const endBalance = await vaultCollateralToken.balanceOf(someAddress);
        const reward = await convertFromUSD5(settings.confirmationByOthersRewardUSD5, vaultCollateralType, settings);
        const rewardPaid = BN.min(reward, startAgentBalance);
        assert.equal(endBalance.sub(startBalance).toString(), rewardPaid.toString());
    });

    it("Should perform minting and change status from NORMAL to LIQUIDATION", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2000);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
        // pay for and execute minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // the minting status should now be 'done'
        orm.em.clear();
        const openMintingsAfter = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(openMintingsAfter.length, 0);
        const mintingAfter = await agentBot.minting.findMinting(orm.em, minting.requestId);
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
        // check agent status
        const status1 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status1, AgentStatus.NORMAL);
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        await agentBot.runStep(orm.em);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.LIQUIDATION);
    });

    it("Should perform minting and change status from NORMAL via LIQUIDATION to NORMAL", async () => {
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2000);
        await agentBot.runStep(orm.em);
        // should have an open minting
        orm.em.clear();
        const mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const minting = mintings[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
        // pay for and execute minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // the minting status should now be 'done'
        orm.em.clear();
        const openMintingsAfter = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(openMintingsAfter.length, 0);
        const mintingAfter = await agentBot.minting.findMinting(orm.em, minting.requestId);
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
        // check agent status
        const status1 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status1, AgentStatus.NORMAL);
        // change price
        const { 0: assetPrice } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice.muln(10000), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(assetPrice.muln(10000), 0);
        // start liquidation
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // change price back
        const { 0: assetPrice2 } = await context.assetFtso.getCurrentPrice();
        await context.assetFtso.setCurrentPrice(assetPrice2.divn(10000), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(assetPrice2.divn(10000), 0);
        // agent ends liquidation
        await context.assetManager.endLiquidation(agentBot.agent.vaultAddress, { from: agentBot.agent.owner.workAddress });
        // check agent status
        const status3 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status3, AgentStatus.NORMAL);
    });

    it("Should check collateral ratio after price changes", async () => {
        const spyTop = spy.on(agentBot.collateralManagement, "checkAgentForCollateralRatiosAndTopUp");
        // reset transientStorage to force priceEvent check
        agentBot.transientStorage.lastPriceReaderEventBlock = -1;
        agentBot.transientStorage.waitingForLatestBlockProofSince = BN_ZERO;
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        expect(spyTop).to.have.been.called.exactly(1);
        // afterwards, price change shouldn't happen until next price finalization event
        await agentBot.runStep(orm.em);
        expect(spyTop).to.have.been.called.exactly(1);
        // mock price changes
        await context.ftsoManager.mockFinalizePriceEpoch();
        // now the collateral ratio check must happen again
        await agentBot.runStep(orm.em);
        expect(spyTop).to.have.been.called.exactly(2);
    });

    it("Should announce agent destruction, change status from NORMAL via DESTROYING, destruct agent and set active to false", async () => {
        const agentBotEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // check agent status
        const status = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status, AgentStatus.NORMAL);
        // redeem pool
        const agentInfo = await agentBot.agent.getAgentInfo();
        const amount = await context.wNat.balanceOf(agentInfo.collateralPool);
        const withdrawAllowedAt = await agentBot.agent.announcePoolTokenRedemption(amount);
        await time.increaseTo(withdrawAllowedAt);
        await agentBot.agent.redeemCollateralPoolTokens(amount);

        // exit available
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await agentBot.agent.exitAvailable();
        // announce agent destruction
        await agentBot.agent.announceDestroy();
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.DESTROYING);
        // increase time
        await time.increase(Number(settings.withdrawalWaitMinSeconds) * 2);
        // agent destruction
        await agentBot.agent.destroy();
        // handle destruction
        await agentBot.runStep(orm.em);
        assert.equal(agentBotEnt.active, false);
    });

    it("Should announce to close vault only if no tickets are open for that agent", async () => {
        const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // perform minting
        const lots = 2;
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // exit available
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await agentBot.agent.exitAvailable();
        // close vault
        agentEnt.waitingForDestructionCleanUp = true;
        await agentBot.runStep(orm.em);
        expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(lots);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // run agent's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, rdReq.requestId);
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
        }
        // clear dust
        const info = await agentBot.agent.getAgentInfo();
        if (!toBN(info.dustUBA).eqn(0)) {
            await agentBot.agent.selfClose((await agentBot.agent.getAgentInfo()).dustUBA);
        }
        // run agent's steps until destroy is announced
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.increase(30);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if destroy is announced
            orm.em.clear();
            const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
            console.log(`Agent step ${i}, waitingForDestructionCleanUp = ${agentEnt.waitingForDestructionCleanUp}`);
            if (agentEnt.waitingForDestructionCleanUp === false) break;
        }
        // await agentBot.runStep(orm.em);
        const info2 = await agentBot.agent.getAgentInfo();
        assert.equal(String(info2.totalVaultCollateralWei), "0");
        assert.equal(String(info2.totalPoolCollateralNATWei), "0");
        const status = Number(info2.status);
        assert.equal(status, AgentStatus.DESTROYING);
    });

    it("Should fail to send notification - faulty notifier", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false, [new FaultyNotifierTransport()]);
        const spyConsole = spy.on(console, "error");
        // create collateral reservation and perform minting
        await createCRAndPerformMinting(minter, agentBot.agent.vaultAddress, 2000, chain);
        // check agent status
        const status1 = await getAgentStatus(agentBot);
        assert.equal(status1, AgentStatus.NORMAL);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 5), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress, { from: minter.address });
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.CCB);
        // run bot
        await agentBot.handleEvents(orm.em);
        expect(spyConsole).to.have.been.called.exactly(5);
    });

    it("Should not top up collateral - fails on owner side due to no vault collateral", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false);
        const spyTopUpFailed = spy.on(agentBot.notifier, "sendVaultCollateralTopUpFailedAlert");
        const spyLowOwnerBalance = spy.on(agentBot.notifier, "sendLowBalanceOnOwnersAddress");
        const spyVaultTopUp = spy.on(agentBot.notifier, "sendVaultCollateralTopUpAlert");
        const spyPoolTopUp = spy.on(agentBot.notifier, "sendPoolCollateralTopUpAlert");
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2000, orm, chain);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(14, 6), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(14, 6), 0);
        // mock price changes and run
        await context.ftsoManager.mockFinalizePriceEpoch();
        // send notifications: top up failed and low balance on ownerAddress
        await agentBot.runStep(orm.em);
        expect(spyTopUpFailed).to.have.been.called.once;
        expect(spyLowOwnerBalance).to.have.been.called.exactly(2);
        // top up ownerAddress
        const deposit = toBNExp(5_000_000, 6).toString();
        await mintVaultCollateralToOwner(deposit, (await agentBot.agent.getAgentInfo()).vaultCollateralToken, ownerAddress);
        // mock price changes and run liquidation trigger
        await context.ftsoManager.mockFinalizePriceEpoch();
        // send notifications: top up successful
        await agentBot.runStep(orm.em);
        expect(spyVaultTopUp).to.have.been.called.once;
        expect(spyPoolTopUp).to.have.been.called.once;
    });

    it("Should not top up collateral - fails on owner side due to no NAT", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false);
        const ownerBalance = toBN(await web3.eth.getBalance(ownerAddress));
        const agentB = await createTestAgent(context, ownerManagementAddress, undefined, false);
        // calculate minuimum amount of native currency to hold by agent owner
        const spyVaultTopUpFailed = spy.on(agentBot.notifier, "sendVaultCollateralTopUpFailedAlert");
        const spyPoolTopUpFailed = spy.on(agentBot.notifier, "sendPoolCollateralTopUpFailedAlert");
        const spyLowOwnerBalance = spy.on(agentBot.notifier, "sendLowBalanceOnOwnersAddress");
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2000, orm, chain);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(14, 6), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(14, 6), 0);
        // mock price changes and run
        await context.ftsoManager.mockFinalizePriceEpoch();
        // make an agent hold less than minimum amount of NAT reserves
        const agentInfo = await agentBot.agent.getAgentInfo()
        const minNative = toBN(agentInfo.totalPoolCollateralNATWei)
            .sub(toBN(agentInfo.freePoolCollateralNATWei))
            .muln(agentBot.agentBotSettings.poolCollateralReserveFactor);
        const deposit = ownerBalance.sub(minNative)
        await agentB.buyCollateralPoolTokens(deposit);
        // send notifications: top up failed and low balance on ownerAddress
        await agentBot.runStep(orm.em);
        expect(spyVaultTopUpFailed).to.have.been.called.once;
        expect(spyPoolTopUpFailed).to.have.been.called.once;
        expect(spyLowOwnerBalance).to.have.been.called.exactly(3);
        // redeem pool tokens
        const redeemAt = await agentB.announcePoolTokenRedemption(deposit);
        await time.increaseTo(redeemAt);
        await agentB.redeemCollateralPoolTokens(deposit);
        const ownerBalanceAfter = toBN(await web3.eth.getBalance(ownerAddress));
        expect(ownerBalanceAfter.gte(deposit)).to.be.true;
    });

    it("Should not top up collateral - fails on owner side due to no NAT", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false);
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2, orm, chain);
        await context.ftsoManager.mockFinalizePriceEpoch();
        await agentBot.runStep(orm.em);
        // change prices
        await context.assetFtso.setCurrentPrice(toBNExp(10, 7), 0);
        await context.assetFtso.setCurrentPriceFromTrustedProviders(toBNExp(10, 7), 0);
        await context.ftsoManager.mockFinalizePriceEpoch();
        // create another agent and buy pool tokens
        const agent = await createTestAgent(context, ownerManagementAddress, undefined, false);
        const ownerBalance = toBN(await web3.eth.getBalance(ownerAddress));
        const forDeposit = ownerBalance.sub(ownerBalance.divn(1000000));
        await agent.buyCollateralPoolTokens(forDeposit);
        // check for top up collateral
        await agentBot.runStep(orm.em);
        // redeem pool tokens
        const redeemAt = await agent.announcePoolTokenRedemption(forDeposit);
        await time.increaseTo(redeemAt);
        await agent.redeemCollateralPoolTokens(forDeposit);
        const ownerBalanceAfter = toBN(await web3.eth.getBalance(ownerAddress));
        expect(ownerBalanceAfter.gte(forDeposit)).to.be.true;
    });

    it("Should not destroy agent if some collateral is reserved", async () => {
        const agentBotEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // check agent status
        const status = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status, AgentStatus.NORMAL);
        // exit available
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        //exit available
        await agentBot.agent.exitAvailable();
        agentBotEnt.waitingForDestructionCleanUp = true;
        await agentBot.runStep(orm.em);
        //Expect agent destruction announcement not to be active
        expect(agentBotEnt.waitingForDestructionCleanUp).to.be.true;
        expect(toBN(agentBotEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
    });

    it("Should not destroy agent if the agent is redeeming", async () => {
        const agentBotEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
        // check agent status
        const status = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status, AgentStatus.NORMAL);
        // exit available
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        // create collateral reservation
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        await agentBot.runStep(orm.em);
        //exit available
        await agentBot.agent.exitAvailable();
        agentBotEnt.waitingForDestructionCleanUp = true;
        await agentBot.runStep(orm.em);
        //Expect agent destruction announcement not to be active
        expect(agentBotEnt.waitingForDestructionCleanUp).to.be.true;
        expect(toBN(agentBotEnt.waitingForDestructionTimestamp).eqn(0)).to.be.true;
    });

    it("Should mint all available lots, agent bot is turned off until redemption default is called", async () => {
        // vaultCollateralToken
        const vaultCollateralType = await agentBot.agent.getVaultCollateral();
        const vaultCollateralToken = await IERC20.at(vaultCollateralType.token);
        // mint
        const freeLots = toBN((await agentBot.agent.getAgentInfo()).freeCollateralLots);
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, freeLots.toNumber(), orm, chain);
        // check all lots are minted
        const freeLotsAfter = toBN((await agentBot.agent.getAgentInfo()).freeCollateralLots);
        expect(toBN(freeLotsAfter).eqn(0)).to.be.true;
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // redeemer balance of vault collateral should be 0
        const redBal0 = await vaultCollateralToken.balanceOf(redeemer.address);
        expect(redBal0.eqn(0)).to.be.true;
        //request redemption
        const [rdReqs] = await redeemer.requestRedemption(freeLots);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain and execute redemption default
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        const paymentAmount = toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA));
        const proof = await redeemer.obtainNonPaymentProof(redeemer.underlyingAddress, rdReq.paymentReference, paymentAmount,
            rdReq.firstUnderlyingBlock, rdReq.lastUnderlyingBlock, rdReq.lastUnderlyingTimestamp);
        const res = await redeemer.executePaymentDefault(PaymentReference.decodeId(rdReq.paymentReference), proof, ZERO_ADDRESS);
        // redeemer balance of vault collateral should be > 0
        const redBal1 = await vaultCollateralToken.balanceOf(redeemer.address);
        expect(redBal1.eq(res.redeemedVaultCollateralWei)).to.be.true;
        // close agent (first exit available)
        const exitAllowedAt = await agentBot.agent.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await agentBot.agent.exitAvailable();
        // close
        await agentBot.updateAgentEntity(orm.em, async (agentEnt) => {
            agentEnt.waitingForDestructionCleanUp = true;
        });
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await agentBot.runStep(orm.em);
            // check if agent is not active
            orm.em.clear();
            const agentEnt = await agentBot.fetchAgentEntity(orm.em)
            console.log(`Agent step ${i}, active = ${agentEnt.active}`);
            if (agentEnt.active === false) break;
        }
    });
});
