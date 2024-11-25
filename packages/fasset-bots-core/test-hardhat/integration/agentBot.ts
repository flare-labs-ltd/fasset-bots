import { FilterQuery } from "@mikro-orm/core";
import { expectRevert, time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import { assert, expect, spy, use } from "chai";
import spies from "chai-spies";
import { BlockNumber } from "web3-core";
import { AgentBot } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { AgentEntity, AgentMinting } from "../../src/entities/agent";
import { AgentHandshakeState, AgentMintingState, AgentRedemptionFinalState, AgentRedemptionState, RejectedRedemptionRequestState } from "../../src/entities/common";
import { AgentStatus, AssetManagerSettings } from "../../src/fasset/AssetManagerTypes";
import { PaymentReference } from "../../src/fasset/PaymentReference";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { MockFlareDataConnectorClient } from "../../src/mock/MockFlareDataConnectorClient";
import { Redeemer } from "../../src/mock/Redeemer";
import { programVersion } from "../../src/utils";
import { Web3ContractEventDecoder } from "../../src/utils/events/Web3ContractEventDecoder";
import { filterEventList } from "../../src/utils/events/truffle";
import { attestationWindowSeconds, proveAndUpdateUnderlyingBlock } from "../../src/utils/fasset-helpers";
import { BN_ZERO, MAX_BIPS, ZERO_ADDRESS, assertNotNull, checkedCast, requireNotNull, toBN, toBNExp } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { AgentOwnerRegistryInstance, Truffle } from "../../typechain-truffle";
import { FaultyNotifierTransport } from "../test-utils/FaultyNotifierTransport";
import { TestAssetBotContext, createTestAssetContext } from "../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../test-utils/hardhat-test-helpers";
import { QUERY_WINDOW_SECONDS, assertWeb3DeepEqual, convertFromUSD5, createCRAndPerformMinting, createCRAndPerformMintingAndRunSteps, createTestAgent, createTestAgentAndMakeAvailable, createTestAgentBotAndMakeAvailable, createTestMinter, createTestRedeemer, getAgentStatus, mintVaultCollateralToOwner, runWithManualFDCFinalization, updateAgentBotUnderlyingBlockProof } from "../test-utils/helpers";
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
    const sanctionedUnderlyingAddress = "SANCTIONED_UNDERLYING";

    async function testSetWorkAddress(agentOwnerRegistry: AgentOwnerRegistryInstance, managementAddress: string, managementPrivateKey: string, workAddress: string) {
        const methodAbi = requireNotNull(agentOwnerRegistry.abi.find(it => it.name === "setWorkAddress"));
        const data = web3.eth.abi.encodeFunctionCall(methodAbi, [workAddress]);
        const account = web3.eth.accounts.privateKeyToAccount(managementPrivateKey);
        assert.equal(account.address, managementAddress);
        const signedTx = await web3.eth.accounts.signTransaction({ from: managementAddress, to: agentOwnerRegistry.address, data: data, gas: 100000 }, managementPrivateKey);
        await web3.eth.sendSignedTransaction(requireNotNull(signedTx.rawTransaction));
    }

    async function enableHandshake() {
        const settingsBeforeUpdate = await agentBot.agent.getAgentSettings();
        assert.equal(settingsBeforeUpdate.handshakeType, 0);
        // announce updates
        const validAt = await agentBot.agent.announceAgentSettingUpdate("handshakeType", 1);
        // increase time
        await time.increaseTo(validAt);
        await agentBot.agent.executeAgentSettingUpdate("handshakeType");
        // check if the setting was updated
        const settingsAfterUpdate = await agentBot.agent.getAgentSettings();
        assert.equal(settingsAfterUpdate.handshakeType, 1);
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
            "Unknown account");
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
        const mintingAfter = await agentBot.minting.findMinting(orm.em, { requestId: minting.requestId });
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
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const balanceBefore = await context.fAsset.balanceOf(redeemer.address);
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        const balanceAfter = await context.fAsset.balanceOf(redeemer.address);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(transferFee));
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
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
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
        assert.equal(mintings[0].state, AgentMintingState.STARTED);
        // run it also now to cover else
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        assert.equal(mintings[0].state, AgentMintingState.STARTED);
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp));
        chain.mine(Number(crt.lastUnderlyingBlock));
        // get time proof
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // handle again
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedNonPaymentProof'
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        assert.equal(mintings[0].state, AgentMintingState.REQUEST_NON_PAYMENT_PROOF);
        // check if minting is done
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.minting.findMinting(orm.em, { requestId: crt.collateralReservationId });
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
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedPaymentProof'
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingRequestedNonPaymentProof = mintings[0];
        assert.equal(mintingRequestedNonPaymentProof.state, AgentMintingState.REQUEST_PAYMENT_PROOF);
        // check if minting is done
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        const mintingDone = await agentBot.minting.findMinting(orm.em, { requestId: crt.collateralReservationId });
        assert.equal(mintingDone.state, AgentMintingState.DONE);
    });

    it("Should perform minting - minter pays, agent execute minting; needs to retry flare data connector payment request", async () => {
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
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedPaymentProof'
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingRequestedPaymentProof = mintings[0];
        assert.equal(mintingRequestedPaymentProof.state, AgentMintingState.REQUEST_PAYMENT_PROOF);
        // remove the proof
        const fdcClient = checkedCast(context.attestationProvider.flareDataConnector, MockFlareDataConnectorClient);
        delete fdcClient.finalizedRounds[fdcClient.finalizedRounds.length - 1].proofs[mintingRequestedPaymentProof.proofRequestData!];
        // check if minting is done
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        const mintingRequestedPaymentProof1 = await agentBot.minting.findMinting(orm.em, { requestId: crt.collateralReservationId });
        assert.equal(mintingRequestedPaymentProof1.state, AgentMintingState.REQUEST_PAYMENT_PROOF);
        // after one more flare data connector round, the minting should be reset to started
        fdcClient.rounds.push([]);
        await fdcClient.finalizeRound();
        // check minting status
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        const mintingRestart = await agentBot.minting.findMinting(orm.em, { requestId: crt.collateralReservationId });
        assert.equal(mintingRestart.state, AgentMintingState.STARTED);
        // handle again
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        // should have one open minting with state 'requestedPaymentProof'
        mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 1);
        const mintingRequestedPaymentProof2 = mintings[0];
        assert.equal(mintingRequestedPaymentProof2.state, AgentMintingState.REQUEST_PAYMENT_PROOF);
        // check if minting is done
        await agentBot.minting.handleOpenMintings(orm.em);
        orm.em.clear();
        const mintingDone2 = await agentBot.minting.findMinting(orm.em, { requestId: crt.collateralReservationId });
        assert.equal(mintingDone2.state, AgentMintingState.DONE);
    });

    it("Should perform minting and redemption; needs to retry flare data connector payment request in redemption", async () => {
        const spyCCP = spy.on(agentBot.redemption, "checkConfirmPayment");
        // perform minting
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const balanceBefore = await context.fAsset.balanceOf(redeemer.address);
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        const balanceAfter = await context.fAsset.balanceOf(redeemer.address);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(transferFee));
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await time.advanceBlock();
        chain.mine();
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // detect redemption request and pay
        await agentBot.runStep(orm.em);
        // check redemption state
        orm.em.clear();
        let redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemption.state, AgentRedemptionState.PAID);
        chain.mine(5);
        // submit proof
        await runWithManualFDCFinalization(context, true, () => agentBot.redemption.handleOpenRedemptions(orm.em));
        orm.em.clear();
        redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemption.state, AgentRedemptionState.REQUESTED_PROOF);
        expect(spyCCP).to.have.been.called.exactly(1);
        // remove the proof
        const fdcClient = checkedCast(context.attestationProvider.flareDataConnector, MockFlareDataConnectorClient);
        delete fdcClient.finalizedRounds[fdcClient.finalizedRounds.length - 1].proofs[redemption.proofRequestData!];
        // redemption status should be stuck
        await runWithManualFDCFinalization(context, true, () => agentBot.redemption.handleOpenRedemptions(orm.em));
        orm.em.clear();
        redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemption.state, AgentRedemptionState.REQUESTED_PROOF);
        expect(spyCCP).to.have.been.called.exactly(2);
        // after one more flare data connector round, the minting should be reset to paid
        fdcClient.rounds.push([]);
        await fdcClient.finalizeRound();
        // check minting status
        await runWithManualFDCFinalization(context, true, () => agentBot.redemption.handleOpenRedemptions(orm.em));
        orm.em.clear();
        redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemption.state, AgentRedemptionState.PAID);
        // handle again
        await runWithManualFDCFinalization(context, true, () => agentBot.redemption.handleOpenRedemptions(orm.em));
        orm.em.clear();
        redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemption.state, AgentRedemptionState.REQUESTED_PROOF);
        expect(spyCCP).to.have.been.called.exactly(4);
        // and now it should be done
        await runWithManualFDCFinalization(context, true, () => agentBot.redemption.handleOpenRedemptions(orm.em));
        orm.em.clear();
        redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemption.state, AgentRedemptionState.DONE);
        await agentBot.runStep(orm.em);
        assert.equal(redemption.finalState, AgentRedemptionFinalState.PERFORMED);
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
        const mintingDone = await agentBot.minting.findMinting(orm.em, { requestId: crt.collateralReservationId });
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

    it("Should approve handshake and perform minting", async () => {
        await enableHandshake();
        const hr = await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open handshake but no mintings
        orm.em.clear();
        const mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 0);
        const handshakes = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(handshakes.length, 1);
        assert.equal(handshakes[0].requestId.toString(), hr.collateralReservationId.toString());
        const handshake = handshakes[0];
        assert.equal(handshake.state, AgentHandshakeState.STARTED);
        const blockNumberBeforeHandshake = await web3.eth.getBlockNumber();
        // update handshake status and create minting request
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'APPROVED'
        orm.em.clear();
        const openHandshakesAfter = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(openHandshakesAfter.length, 0);
        const handshakeAfter = await agentBot.handshake.findHandshake(orm.em, { requestId: handshake.requestId });
        assert.equal(handshakeAfter!.state, AgentHandshakeState.APPROVED);
        // agent should have an open minting
        const mintingsAfter = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintingsAfter.length, 1);
        const minting = mintingsAfter[0];
        assert.equal(minting.state, AgentMintingState.STARTED);
        const allEvents = await readEventsFrom(context.assetManager, blockNumberBeforeHandshake);
        const events = filterEventList(allEvents, context.assetManager, "CollateralReserved");
        assert.equal(events.length, 1);
        const crt = events[0].args;
        // pay for and execute minting
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // the minting status should now be 'done'
        orm.em.clear();
        const openMintingsAfter = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(openMintingsAfter.length, 0);
        const mintingAfter = await agentBot.minting.findMinting(orm.em, { requestId: minting.requestId });
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
    });

    it("Should reject minting if handshake is enabled - sanctioned underlying address", async () => {
        await enableHandshake();
        // perform minting
        minter = await createTestMinter(context, minterAddress, chain, sanctionedUnderlyingAddress);
        const hr = await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        // should have an open handshake but no mintings
        orm.em.clear();
        const mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 0);
        const handshakes = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(handshakes.length, 1);
        assert.equal(handshakes[0].requestId.toString(), hr.collateralReservationId.toString());
        const handshake = handshakes[0];
        assert.equal(handshake.state, AgentHandshakeState.STARTED);
        // update handshake status
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'REJECTED'
        orm.em.clear();
        const openHandshakesAfter = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(openHandshakesAfter.length, 0);
        const handshakeAfter = await agentBot.handshake.findHandshake(orm.em, { requestId: handshake.requestId });
        assert.equal(handshakeAfter!.state, AgentHandshakeState.REJECTED);
    });

    it("Should reject minting if handshake is enabled - balance too low", async () => {
        await enableHandshake();
        // perform minting
        minter = await createTestMinter(context, minterAddress, chain, "RANDOM_MINTER_UNDERLYING_ADDRESS", BN_ZERO);
        const hr = await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2, ZERO_ADDRESS, "0", false);
        await agentBot.runStep(orm.em);
        // should have an open handshake but no mintings
        orm.em.clear();
        const mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 0);
        const handshakes = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(handshakes.length, 1);
        assert.equal(handshakes[0].requestId.toString(), hr.collateralReservationId.toString());
        const handshake = handshakes[0];
        assert.equal(handshake.state, AgentHandshakeState.STARTED);
        // update handshake status
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'REJECTED'
        orm.em.clear();
        const openHandshakesAfter = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(openHandshakesAfter.length, 0);
        const handshakeAfter = await agentBot.handshake.findHandshake(orm.em, { requestId: handshake.requestId });
        assert.equal(handshakeAfter!.state, AgentHandshakeState.REJECTED);
    });

    it("Should cancel minting if agent did not approve it in time", async () => {
        await enableHandshake();
        const hr = await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2);
        await agentBot.handleEvents(orm.em);
        // should have an open handshake but no mintings
        orm.em.clear();
        const mintings = await agentBot.minting.openMintings(orm.em, false);
        assert.equal(mintings.length, 0);
        const handshakes = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(handshakes.length, 1);
        assert.equal(handshakes[0].requestId.toString(), hr.collateralReservationId.toString());
        const handshake = handshakes[0];
        assert.equal(handshake.state, AgentHandshakeState.STARTED);

        // should not be able to cancel handshake before time passes
        await expectRevert(minter.cancelCollateralReservation(hr.collateralReservationId), "collateral reservation cancellation too early");

        // skip time so the handshake can be cancelled
        await time.increase(settings.cancelCollateralReservationAfterSeconds);
        const ccr = await minter.cancelCollateralReservation(hr.collateralReservationId);
        assert.equal(ccr.collateralReservationId.toString(), hr.collateralReservationId.toString());
        assert.equal(ccr.agentVault, agentBot.agent.vaultAddress);
        assert.equal(ccr.minter, minter.address);

        // update handshake status
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'CANCELLED'
        orm.em.clear();
        const openHandshakesAfter = await agentBot.handshake.openHandshakes(orm.em, false);
        assert.equal(openHandshakesAfter.length, 0);
        const handshakeAfter = await agentBot.handshake.findHandshake(orm.em, { requestId: handshake.requestId });
        assert.equal(handshakeAfter!.state, AgentHandshakeState.CANCELLED);
    });

    it("Should perform minting and redemption with handshake enabled", async () => {
        await enableHandshake();
        // perform minting
        const hs = await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const blockNumberBeforeHandshake = await web3.eth.getBlockNumber();
        // update handshake status and create minting request
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'APPROVED'
        const allEvents = await readEventsFrom(context.assetManager, blockNumberBeforeHandshake);
        const events = filterEventList(allEvents, context.assetManager, "CollateralReserved");
        assert.equal(events.length, 1);
        const crt = events[0].args;
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // create another agent and mint some FAssets
        const agent2 = await createTestAgentAndMakeAvailable(context, accounts[321], "UNDERLYING_ADDRESS_1");
        // execute minting
        const crt1 = await minter.reserveCollateral(agent2.vaultAddress, 2);
        const txHash1 = await minter.performMintingPayment(crt1);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt1, txHash1);
        // agent buys missing fAssets
        const transferFeeMillionths = await agentBot.agent.assetManager.transferFeeMillionths();
        const amount = toBN(fBalance).mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, amount, { from: minter.address });

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
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // redeemer should now have some funds on the underlying chain
        const balance = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance), String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))));
    });

    it("Should reject redemption if handshake is enabled - sanctioned underlying address, redeemer default", async () => {
        await enableHandshake();
        redeemer = await createTestRedeemer(context, redeemerAddress, sanctionedUnderlyingAddress);
        const startBalance = await chain.getBalance(agentBot.agent.underlyingAddress);
        // perform minting
        await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const blockNumberBeforeHandshake = await web3.eth.getBlockNumber();
        // update handshake status and create minting request
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'APPROVED'
        const allEvents = await readEventsFrom(context.assetManager, blockNumberBeforeHandshake);
        const events = filterEventList(allEvents, context.assetManager, "CollateralReserved");
        assert.equal(events.length, 1);
        const crt = events[0].args;
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // create another agent and mint some FAssets
        const agent2 = await createTestAgentAndMakeAvailable(context, accounts[321], "UNDERLYING_ADDRESS_1");
        // execute minting
        const crt1 = await minter.reserveCollateral(agent2.vaultAddress, 2);
        const txHash1 = await minter.performMintingPayment(crt1);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt1, txHash1);
        // agent buys missing fAssets
        const transferFeeMillionths = await agentBot.agent.assetManager.transferFeeMillionths();
        const amount = toBN(fBalance).mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, amount, { from: minter.address });
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
            // check if redemption is rejected
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.REJECTED) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // agent should still have all funds on the underlying chain
        const balance = await chain.getBalance(agentBot.agent.underlyingAddress);
        assert.equal(String(balance), String(toBN(crt.valueUBA).add(toBN(crt.feeUBA)).add(startBalance)));

        // redeemer cannot default immediately
        await expectRevert(redeemer.executeRejectedPaymentDefault(rdReq.requestId, ZERO_ADDRESS), "rejected redemption default too early");

        // skip time so the redemption can be defaulted
        await time.increase(settings.takeOverRedemptionRequestWindowSeconds);
        const res = await redeemer.executeRejectedPaymentDefault(rdReq.requestId, ZERO_ADDRESS);

        // vaultCollateralToken
        const vaultCollateralType = await agentBot.agent.getVaultCollateral();
        const vaultCollateralToken = await IERC20.at(vaultCollateralType.token);

        // redeemer balance of vault collateral should be > 0
        const redBalance = await vaultCollateralToken.balanceOf(redeemer.address);
        expect(redBalance.eq(res.redeemedVaultCollateralWei)).to.be.true;
        expect(redBalance.gt(BN_ZERO)).to.be.true;

        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // step should expire
        await agentBot.runStep(orm.em);
        // check redemption
        orm.em.clear();
        const redemptionDone = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
        assert.equal(redemptionDone.finalState, AgentRedemptionFinalState.HANDSHAKE_REJECTED);
    });

    it("Should reject redemption if handshake is enabled - sanctioned underlying address - other agents take over", async () => {
        await enableHandshake();
        redeemer = await createTestRedeemer(context, redeemerAddress, sanctionedUnderlyingAddress);
        const startBalance = await chain.getBalance(agentBot.agent.underlyingAddress);

        // perform minting
        await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const blockNumberBeforeHandshake = await web3.eth.getBlockNumber();
        // update handshake status and create minting request
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'APPROVED' and minting should start
        const allEvents = await readEventsFrom(context.assetManager, blockNumberBeforeHandshake);
        const events = filterEventList(allEvents, context.assetManager, "CollateralReserved");
        assert.equal(events.length, 1);
        const crt = events[0].args;
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);

        // create second agent that will take over the redemption and mint the funds
        const agentBot2 = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false);
        const minter2 = await createTestMinter(context, minterAddress, chain, "REDEEMER2_UNDERLYING_ADDRESS");
        const crt2 = await minter2.reserveCollateral(agentBot2.agent.vaultAddress, 2);
        await agentBot2.runStep(orm.em);
        const txHash2 = await minter2.performMintingPayment(crt2);
        chain.mine(chain.finalizationBlocks + 1);
        await minter2.executeMinting(crt2, txHash2);
        await agentBot2.runStep(orm.em);

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
            // check if redemption is rejected
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.REJECTED) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // agent should still have all funds on the underlying chain
        const balance = await chain.getBalance(agentBot.agent.underlyingAddress);
        assert.equal(String(balance), String(toBN(crt.valueUBA).add(toBN(crt.feeUBA)).add(startBalance)));

        // agent 2 with disabled handshake should take over the redemption
        await agentBot2.runStep(orm.em); // first take over
        await agentBot.runStep(orm.em);
        // check if rejected redemption stored in both bots
        orm.em.clear();
        const rejectedRedemption = await agentBot.redemption.findRejectedRedemptionRequest(orm.em, { requestId: rdReq.requestId });
        assertNotNull(rejectedRedemption);
        assert.equal(rejectedRedemption.state, RejectedRedemptionRequestState.DONE);
        assert.equal(rejectedRedemption.agentAddress, agentBot.agent.vaultAddress);
        assert.equal(rejectedRedemption.redeemerAddress, redeemer.address);
        assert.equal(rejectedRedemption.valueUBA.toString(), rdReq.valueUBA.toString());
        assert.equal(rejectedRedemption.paymentAddress, rdReq.paymentAddress);
        assert.equal(rejectedRedemption.valueTakenOverUBA.toString(), rdReq.valueUBA.toString());
        const rejectedRedemption2 = await agentBot2.redemption.findRejectedRedemptionRequest(orm.em, { requestId: rdReq.requestId });
        assertNotNull(rejectedRedemption2);
        assert.equal(rejectedRedemption2.state, RejectedRedemptionRequestState.DONE);
        assert.equal(rejectedRedemption2.agentAddress, agentBot2.agent.vaultAddress);
        assert.equal(rejectedRedemption2.redeemerAddress, redeemer.address);
        assert.equal(rejectedRedemption2.valueUBA.toString(), rdReq.valueUBA.toString());
        assert.equal(rejectedRedemption2.paymentAddress, rdReq.paymentAddress);
        assert.equal(rejectedRedemption2.valueTakenOverUBA.toString(), BN_ZERO.toString());

        const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: toBN(rdReq.requestId) });
        assert.equal(redemption.state, AgentRedemptionState.DONE);
        assert.equal(redemption.finalState, AgentRedemptionFinalState.HANDSHAKE_REJECTED);
        assert.equal(redemption.rejectedRedemptionRequest?.id, rejectedRedemption.id);

        // update rejected redemption
        await agentBot2.runStep(orm.em);
        orm.em.clear();
        const rejectedRedemption3 = await agentBot2.redemption.findRejectedRedemptionRequest(orm.em, { requestId: rdReq.requestId });
        assertNotNull(rejectedRedemption3);
        assert.equal(rejectedRedemption3.valueTakenOverUBA.toString(), rdReq.valueUBA.toString());

        const redemptions = await agentBot2.redemption.redemptionsInState(orm.em, AgentRedemptionState.PAID, 1000);
        assert.equal(redemptions.length, 1);
        const redemption2 = redemptions[0];
        assert.equal(redemption2.rejectedRedemptionRequest?.id, rejectedRedemption2.id);

        // run agent2's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot2);
            await time.advanceBlock();
            chain.mine();
            await agentBot2.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption3 = await agentBot2.redemption.findRedemption(orm.em, { requestId: redemption2.requestId });
            console.log(`Agent step ${i}, state = ${redemption3.state}`);
            if (redemption3.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // redeemer should now have some funds on the underlying chain
        const balance2 = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance2), String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA))));
    });

    it("Should reject redemption if handshake is enabled - sanctioned underlying address - other agents take over only part of it, other part is defaulted", async () => {
        await enableHandshake();
        redeemer = await createTestRedeemer(context, redeemerAddress, sanctionedUnderlyingAddress);
        const startBalance = await chain.getBalance(agentBot.agent.underlyingAddress);

        // perform minting
        await minter.reserveCollateralHandshake(agentBot.agent.vaultAddress, 2);
        await agentBot.runStep(orm.em);
        const blockNumberBeforeHandshake = await web3.eth.getBlockNumber();
        // update handshake status and create minting request
        await agentBot.runStep(orm.em);
        // the handshake status should now be 'APPROVED' and minting should start
        const allEvents = await readEventsFrom(context.assetManager, blockNumberBeforeHandshake);
        const events = filterEventList(allEvents, context.assetManager, "CollateralReserved");
        assert.equal(events.length, 1);
        const crt = events[0].args;
        const txHash = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        await agentBot.runStep(orm.em);

        // create second agent that will take over the redemption and mint the funds
        const agentBot2 = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false);
        const minter2 = await createTestMinter(context, minterAddress, chain, "REDEEMER2_UNDERLYING_ADDRESS");
        const crt2 = await minter2.reserveCollateral(agentBot2.agent.vaultAddress, 1);
        await agentBot2.runStep(orm.em);
        const txHash2 = await minter2.performMintingPayment(crt2);
        chain.mine(chain.finalizationBlocks + 1);
        await minter2.executeMinting(crt2, txHash2);
        await agentBot2.runStep(orm.em);

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
            // check if redemption is rejected
            orm.em.clear();
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.REJECTED) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // agent should still have all funds on the underlying chain
        const balance = await chain.getBalance(agentBot.agent.underlyingAddress);
        assert.equal(String(balance), String(toBN(crt.valueUBA).add(toBN(crt.feeUBA)).add(startBalance)));

        // agent 2 with disabled handshake should take over the redemption
        await agentBot2.runStep(orm.em); // first take over
        await agentBot.runStep(orm.em);
        // check if rejected redemption stored in both bots
        orm.em.clear();
        const rejectedRedemption = await agentBot.redemption.findRejectedRedemptionRequest(orm.em, { requestId: rdReq.requestId });
        assertNotNull(rejectedRedemption);
        assert.equal(rejectedRedemption.state, RejectedRedemptionRequestState.DONE);
        assert.equal(rejectedRedemption.agentAddress, agentBot.agent.vaultAddress);
        assert.equal(rejectedRedemption.redeemerAddress, redeemer.address);
        assert.equal(rejectedRedemption.valueUBA.toString(), rdReq.valueUBA.toString());
        assert.equal(rejectedRedemption.paymentAddress, rdReq.paymentAddress);
        assert.equal(rejectedRedemption.valueTakenOverUBA.toString(), toBN(rdReq.valueUBA).divn(2).toString());
        const rejectedRedemption2 = await agentBot2.redemption.findRejectedRedemptionRequest(orm.em, { requestId: rdReq.requestId });
        assertNotNull(rejectedRedemption2);
        assert.equal(rejectedRedemption2.state, RejectedRedemptionRequestState.DONE);
        assert.equal(rejectedRedemption2.agentAddress, agentBot2.agent.vaultAddress);
        assert.equal(rejectedRedemption2.redeemerAddress, redeemer.address);
        assert.equal(rejectedRedemption2.valueUBA.toString(), rdReq.valueUBA.toString());
        assert.equal(rejectedRedemption2.paymentAddress, rdReq.paymentAddress);
        assert.equal(rejectedRedemption2.valueTakenOverUBA.toString(), BN_ZERO.toString());

        const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: toBN(rdReq.requestId) });
        assert.equal(redemption.state, AgentRedemptionState.REJECTED);
        assert.isNull(redemption.finalState);
        assert.equal(redemption.rejectedRedemptionRequest?.id, rejectedRedemption.id);

        // update rejected redemption
        await agentBot2.runStep(orm.em);
        orm.em.clear();
        const rejectedRedemption3 = await agentBot2.redemption.findRejectedRedemptionRequest(orm.em, { requestId: rdReq.requestId });
        assertNotNull(rejectedRedemption3);
        assert.equal(rejectedRedemption3.valueTakenOverUBA.toString(), toBN(rdReq.valueUBA).divn(2).toString());

        const redemptions = await agentBot2.redemption.redemptionsInState(orm.em, AgentRedemptionState.PAID, 1000);
        assert.equal(redemptions.length, 1);
        const redemption2 = redemptions[0];
        assert.equal(redemption2.rejectedRedemptionRequest?.id, rejectedRedemption2.id);

        // run agent2's steps until redemption process is finished
        for (let i = 0; ; i++) {
            await updateAgentBotUnderlyingBlockProof(context, agentBot2);
            await time.advanceBlock();
            chain.mine();
            await agentBot2.runStep(orm.em);
            // check if redemption is done
            orm.em.clear();
            const redemption3 = await agentBot2.redemption.findRedemption(orm.em, { requestId: redemption2.requestId });
            console.log(`Agent step ${i}, state = ${redemption3.state}`);
            if (redemption3.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // redeemer should now have some funds on the underlying chain
        const balance2 = await chain.getBalance(redeemer.underlyingAddress);
        assert.equal(String(balance2), String(toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA)).divn(2)));

        // skip time so the redemption can be defaulted
        await time.increase(settings.takeOverRedemptionRequestWindowSeconds);

        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // step should expire
        await agentBot.runStep(orm.em);
        // check redemption
        orm.em.clear();
        const redemptionDone = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
        assert.equal(redemptionDone.finalState, AgentRedemptionFinalState.HANDSHAKE_REJECTED);

        // vaultCollateralToken
        const vaultCollateralType = await agentBot.agent.getVaultCollateral();
        const vaultCollateralToken = await IERC20.at(vaultCollateralType.token);

        // redeemer balance of vault collateral should be > 0
        const redBalance = await vaultCollateralToken.balanceOf(redeemer.address);
        expect(redBalance.gt(BN_ZERO)).to.be.true;
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
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        // agentBot stores redemption
        await agentBot.runStep(orm.em);
        const redemptionStarted = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionStarted.state, AgentRedemptionState.UNPAID);
        // agentBot doesn't pay for redemption - expired on underlying
        await agentBot.runStep(orm.em);
        const redemptionNotPaid = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionNotPaid.state, AgentRedemptionState.UNPAID);
        // skip time so the redemption will expire
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        // redemption should be expired
        const redemptionExpired = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionExpired.state, AgentRedemptionState.DONE);
        assert.equal(redemptionExpired.finalState, AgentRedemptionFinalState.EXPIRED_UNPAID);
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
        // claim and send transfer fee to redeemer address
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // redemption started
        await agentBot.handleEvents(orm.em);
        // skip time so the it will be too late for payment
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp) + 10);
        chain.mine(Number(rdReq.lastUnderlyingBlock) + 10);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        const blockHeight = await agentBot.context.blockchainIndexer.getBlockHeight();
        const lastBlock = await agentBot.context.blockchainIndexer.getBlockAt(blockHeight);
        // first step wil set state to UNPAID
        await agentBot.runStep(orm.em);
        orm.em.clear();
        const redemptionUnpaid = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionUnpaid.state, AgentRedemptionState.UNPAID);
        // skip time so the proof will expire in indexer
        const queryWindow = QUERY_WINDOW_SECONDS * 2;
        const queryBlock = Math.round(queryWindow / chain.secondsPerBlock);
        chain.skipTimeTo(Number(crt.lastUnderlyingTimestamp) + queryWindow);
        chain.mine(Number(crt.lastUnderlyingBlock) + queryBlock);
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        // second step should expire
        await agentBot.runStep(orm.em);
        // check redemption
        orm.em.clear();
        const redemptionDone = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
        assert.equal(redemptionDone.finalState, AgentRedemptionFinalState.EXPIRED_UNPAID);
    });

    it("Should perform redemption - agent pays, time expires in indexer: DELETE/REWRITE", async () => {
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
        // claim and send transfer fee to redeemer address
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // request redemption
        const [rdReqs] = await redeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // agent pays
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        const redemptionPaid = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
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
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const redemptionDone = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemptionDone.state, AgentRedemptionState.DONE);
        await agentBot.runStep(orm.em);
        assert.equal(redemptionDone.finalState, AgentRedemptionFinalState.PERFORMED);
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
        // claim and send transfer fee to redeemer address
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
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
        const redemptionPaid = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
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
        await agentBot.runStep(orm.em);
        assert.equal(redemptionPaid.finalState, AgentRedemptionFinalState.PERFORMED);
    });

    it("Should not perform redemption - invalid address", async () => {
        const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
        const txHash = await minter.performMintingPayment(crt);
        context.blockchainIndexer.chain.mine(chain.finalizationBlocks + 1);
        await minter.executeMinting(crt, txHash);
        const invalidRedeemerAddress = accounts[111];
        const invalidUnderlyingAddress = "INVALID";   // breaks checkBeforeRedemptionPayment
        const invalidRedeemer = await createTestRedeemer(context, invalidRedeemerAddress, invalidUnderlyingAddress);
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        await context.fAsset.transfer(invalidRedeemer.address, fBalance, { from: minter.address });
        // claim and send transfer fee to redeemer address
        await agentBot.agent.claimAndSendTransferFee(invalidRedeemer.address);
        // request redemption with invalid address
        const [rdReqs] = await invalidRedeemer.requestRedemption(2);
        assert.equal(rdReqs.length, 1);
        // update underlying block
        const rdReq = rdReqs[0];
        await updateAgentBotUnderlyingBlockProof(context, agentBot);
        await agentBot.runStep(orm.em);
        const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
        assert.equal(redemption.state, AgentRedemptionState.DONE);
        assert.equal(redemption.finalState, AgentRedemptionFinalState.REJECTED);
        // redeemer should not have received any funds
        const balance = await chain.getBalance(invalidRedeemer.underlyingAddress);
        assert.equal(String(balance), String(toBN(0)));
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
        const mintingAfter = await agentBot.minting.findMinting(orm.em, { requestId: minting.requestId });
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
        // check agent status
        const status1 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status1, AgentStatus.NORMAL);
        await context.priceStore.setCurrentPrice(context.chainInfo.symbol, toBNExp(10, 7), 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol, toBNExp(10, 7), 0);
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
        const mintingAfter = await agentBot.minting.findMinting(orm.em, { requestId: minting.requestId });
        assert.equal(mintingAfter.state, AgentMintingState.DONE);
        // check agent status
        const status1 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status1, AgentStatus.NORMAL);
        // change price
        const { 0: assetPrice } = await context.priceStore.getPrice(context.chainInfo.symbol);
        await context.priceStore.setCurrentPrice(context.chainInfo.symbol, assetPrice.muln(10000), 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol, assetPrice.muln(10000), 0);
        // start liquidation
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress);
        // check agent status
        const status2 = Number((await agentBot.agent.getAgentInfo()).status);
        assert.equal(status2, AgentStatus.LIQUIDATION);
        // change price back
        const { 0: assetPrice2 } = await context.priceStore.getPrice(context.chainInfo.symbol);
        await context.priceStore.setCurrentPrice(context.chainInfo.symbol, assetPrice2.divn(10000), 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol, assetPrice2.divn(10000), 0);
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
        await context.priceStore.finalizePrices();
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
        // claim and send transfer fee to redeemer address
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
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
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const info = await agentBot.agent.getAgentInfo();
        // clear dust
        const workAddress = agentBot.agent.owner.workAddress;
        const balanceBefore = await context.fAsset.balanceOf(workAddress);
        let balanceAfter: BN = toBN(0);
        if (!toBN(info.dustUBA).eqn(0)) {
            // agent needs to claim and withdraw fees to have enough fAssets to self close dust
            while (balanceAfter < balanceBefore.add(toBN(info.dustUBA))) {
                const transferFeeEpoch = await agentBot.agent.assetManager.currentTransferFeeEpoch();
                // get epoch duration
                const settings = await agentBot.agent.assetManager.transferFeeSettings();
                const epochDuration = settings.epochDuration;
                // move to next epoch
                await time.increase(epochDuration);
                // agent claims fee to redeemer address
                const args = await agentBot.agent.claimTransferFees(workAddress, transferFeeEpoch);
                await agentBot.agent.withdrawPoolFees(args.poolClaimedUBA, workAddress);
                balanceAfter = await context.fAsset.balanceOf(workAddress);
            }
            await agentBot.agent.selfClose(info.dustUBA);
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // await agentBot.runStep(orm.em);
        const info2 = await agentBot.agent.getAgentInfo();
        assert.equal(String(info2.totalVaultCollateralWei), "0");
        assert.equal(String(info2.totalPoolCollateralNATWei), "0");
        const status = Number(info2.status);
        assert.equal(status, AgentStatus.DESTROYING);
    });

    it("Should announce to close vault only if no tickets are open for that agent - auto claim transfer fees", async () => {
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
        // claim and send transfer fee to redeemer address
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
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
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const info = await agentBot.agent.getAgentInfo();
        if (!toBN(info.dustUBA).eqn(0)) {
            // move to next epoch so transfer fees will be available for claiming
            const settings = await agentBot.agent.assetManager.transferFeeSettings();
            const epochDuration = settings.epochDuration;
            await time.increase(epochDuration);
            chain.skipTime(Number(epochDuration));
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
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        // await agentBot.runStep(orm.em);
        const info2 = await agentBot.agent.getAgentInfo();
        assert.equal(String(info2.totalVaultCollateralWei), "0");
        assert.equal(String(info2.totalPoolCollateralNATWei), "0");
        const status = Number(info2.status);
        assert.equal(status, AgentStatus.DESTROYING);
    });

    it("Should announce to close vault only if no tickets are open for that agent - buy missing FAssets", async () => {
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
        // claim and send transfer fee to redeemer address
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
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
            const redemption = await agentBot.redemption.findRedemption(orm.em, { requestId: rdReq.requestId });
            console.log(`Agent step ${i}, state = ${redemption.state}`);
            if (redemption.state === AgentRedemptionState.DONE) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
        const info = await agentBot.agent.getAgentInfo();
        // create another agent and mint some FAssets
        const agent2 = await createTestAgentAndMakeAvailable(context, accounts[321], "UNDERLYING_ADDRESS_1");
        // execute minting
        const minter2 = await createTestMinter(context, minterAddress, chain);
        const crt1 = await minter2.reserveCollateral(agent2.vaultAddress, 2);
        const txHash1 = await minter2.performMintingPayment(crt1);
        chain.mine(chain.finalizationBlocks + 1);
        await minter2.executeMinting(crt1, txHash1);
        // agent buys missing fAssets
        const missingFAssets = info.mintedUBA;
        const transferFeeMillionths = await agentBot.agent.assetManager.transferFeeMillionths();
        const amount = toBN(missingFAssets).muln(1e6).div(toBN(1e6).sub(transferFeeMillionths));
        await context.fAsset.transfer(agentBot.agent.owner.workAddress, amount, { from: minter.address });

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
            assert.isBelow(i, 50);  // prevent infinite loops
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
        await context.priceStore.setCurrentPrice(context.chainInfo.symbol, toBNExp(10, 5), 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol, toBNExp(10, 5), 0);
        // mock price changes and run liquidation trigger
        await context.priceStore.finalizePrices();
        await context.assetManager.startLiquidation(agentBot.agent.vaultAddress, { from: minter.address });
        // check agent status
        const status2 = await getAgentStatus(agentBot);
        assert.equal(status2, AgentStatus.CCB);
        // run bot
        await agentBot.handleEvents(orm.em);
        expect(spyConsole).to.have.been.called.above(5);
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
        await context.priceStore.setCurrentPrice(context.chainInfo.symbol, toBNExp(14, 6), 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol, toBNExp(14, 6), 0);
        // mock price changes and run
        await context.priceStore.finalizePrices();
        // send notifications: top up failed and low balance on ownerAddress
        await agentBot.runStep(orm.em);
        expect(spyTopUpFailed).to.have.been.called.once;
        expect(spyLowOwnerBalance).to.have.been.called.exactly(2);
        // top up ownerAddress
        const deposit = toBNExp(5_000_000, 6).toString();
        const agentInfo = await agentBot.agent.getAgentInfo();
        await mintVaultCollateralToOwner(deposit, agentInfo.vaultCollateralToken, ownerAddress);
        // mock price changes and run liquidation trigger
        await context.priceStore.finalizePrices();
        // send notifications: top up successful
        await agentBot.runStep(orm.em);
        expect(spyVaultTopUp).to.have.been.called.once;
        expect(spyPoolTopUp).to.have.been.called.once;
    });

    it("Should not top up collateral - fails on owner side due to no NAT", async () => {
        const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerManagementAddress, undefined, false);
        const ownerBalance = toBN(await web3.eth.getBalance(ownerAddress));
        const agentB = await createTestAgent(context, ownerManagementAddress, undefined, false);
        // calculate minimum amount of native currency to hold by agent owner
        const spyVaultTopUpFailed = spy.on(agentBot.notifier, "sendVaultCollateralTopUpFailedAlert");
        const spyPoolTopUpFailed = spy.on(agentBot.notifier, "sendPoolCollateralTopUpFailedAlert");
        const spyLowOwnerBalance = spy.on(agentBot.notifier, "sendLowBalanceOnOwnersAddress");
        const spyCriticalLowOwnerBalance = spy.on(agentBot.notifier, "sendCriticalLowBalanceOnOwnersAddress");
        const minter = await createTestMinter(context, minterAddress, chain);
        // create collateral reservation, perform minting and run
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, 2000, orm, chain);
        // change prices
        await context.priceStore.setCurrentPrice(context.chainInfo.symbol, toBNExp(14, 6), 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol, toBNExp(14, 6), 0);
        // mock price changes and run
        await context.priceStore.finalizePrices();
        // make an agent hold less than minimum amount of NAT reserves
        const agentInfo = await agentBot.agent.getAgentInfo()
        const minNative = toBNExp(199, 18);
        const deposit = ownerBalance.sub(minNative)
        await agentB.buyCollateralPoolTokens(deposit);
        // send notifications: top up failed and low balance on ownerAddress
        await agentBot.runStep(orm.em);
        expect(spyVaultTopUpFailed).to.have.been.called.once;
        expect(spyPoolTopUpFailed).to.have.been.called.once;
        expect(spyLowOwnerBalance).to.have.been.called.exactly(2);
        expect(spyCriticalLowOwnerBalance).to.have.been.called.exactly(1);
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
        await context.priceStore.finalizePrices();
        await agentBot.runStep(orm.em);
        // change prices
        await context.priceStore.setCurrentPrice(context.chainInfo.symbol, toBNExp(10, 7), 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(context.chainInfo.symbol, toBNExp(10, 7), 0);
        await context.priceStore.finalizePrices();
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
        await minter.reserveCollateral(agentBot.agent.vaultAddress, 2);
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
        // withdraw pool fees to have enough fAssets for redemption
        const transferFeeMillionths = await agentBot.agent.assetManager.transferFeeMillionths();
        if (transferFeeMillionths.gt(toBN(0))) {
            const feePaid = fBalance.mul(transferFeeMillionths).divn(1e6);
            const withdrawAmount = feePaid.muln(1e6).div(toBN(1e6).sub(transferFeeMillionths));
            await agentBot.agent.withdrawPoolFees(withdrawAmount, redeemerAddress);
        }
        // request redemption
        await redeemer.requestRedemption(2);
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
        // pool share of collateral reservation fee arrived into pool, so now there are again a few free lots
        const freeLotsAfter = toBN((await agentBot.agent.getAgentInfo()).freeCollateralLots);
        expect(toBN(freeLotsAfter).gtn(0)).to.be.true;
        // mint agin to spend the rest
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, freeLotsAfter.toNumber(), orm, chain);
        // check all lots are minted
        const freeLotsAfter2 = toBN((await agentBot.agent.getAgentInfo()).freeCollateralLots);
        // trace({ freeLots, freeLotsAfter, freeLotsAfter2 });
        expect(toBN(freeLotsAfter2).eqn(0)).to.be.true;
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const balanceBefore = await context.fAsset.balanceOf(redeemer.address);
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        const balanceAfter = await context.fAsset.balanceOf(redeemer.address);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(transferFee));
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // redeemer balance of vault collateral should be 0
        const redBal0 = await vaultCollateralToken.balanceOf(redeemer.address);
        expect(redBal0.eqn(0)).to.be.true;
        //request redemption
        const [rdReqs] = await redeemer.requestRedemption(freeLots.add(freeLotsAfter));
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain and execute redemption default
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        const paymentAmount = toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA));
        const proof = await redeemer.proveNonPayment(redeemer.underlyingAddress, rdReq.paymentReference, paymentAmount,
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
            await runWithManualFDCFinalization(context, true, () => agentBot.runStep(orm.em));
            try {
                const info = await agentBot.agent.getAgentInfo();
                // claim fee and withdraw pool fees to have enough fAssets to self close dust
                if (!toBN(info.dustUBA).eqn(0)) {
                    const workAddress = agentBot.agent.owner.workAddress;
                    const balanceBefore = await context.fAsset.balanceOf(workAddress);
                    let balanceAfter: BN = toBN(0);
                    while (balanceAfter < balanceBefore.add(toBN(info.dustUBA))) {
                        const transferFeeEpoch = await agentBot.agent.assetManager.currentTransferFeeEpoch();
                        // get epoch duration
                        const settings = await agentBot.agent.assetManager.transferFeeSettings();
                        const epochDuration = settings.epochDuration;
                        // move to next epoch
                        await time.increase(epochDuration);
                        // agent claims fee to redeemer address
                        const args = await agentBot.agent.claimTransferFees(workAddress, transferFeeEpoch);
                        await agentBot.agent.withdrawPoolFees(args.poolClaimedUBA, workAddress);
                        balanceAfter = await context.fAsset.balanceOf(workAddress);
                    }
                    await agentBot.agent.selfClose(info.dustUBA);
                }
            } catch (e) {
                // agent destroyed, vault doesn't exist anymore
            }
            // check if agent is not active
            orm.em.clear();
            const agentEnt = await agentBot.fetchAgentEntity(orm.em)
            console.log(`Agent step ${i}, active = ${agentEnt.active}`);
            if (agentEnt.active === false) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
    });

    it("Should mint all available lots, agent bot is turned off until redemption default is called - auto claim transfer fees", async () => {
        // vaultCollateralToken
        const vaultCollateralType = await agentBot.agent.getVaultCollateral();
        const vaultCollateralToken = await IERC20.at(vaultCollateralType.token);
        // mint
        const freeLots = toBN((await agentBot.agent.getAgentInfo()).freeCollateralLots);
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, freeLots.toNumber(), orm, chain);
        // pool share of collateral reservation fee arrived into pool, so now there are again a few free lots
        const freeLotsAfter = toBN((await agentBot.agent.getAgentInfo()).freeCollateralLots);
        expect(toBN(freeLotsAfter).gtn(0)).to.be.true;
        // mint agin to spend the rest
        await createCRAndPerformMintingAndRunSteps(minter, agentBot, freeLotsAfter.toNumber(), orm, chain);
        // check all lots are minted
        const freeLotsAfter2 = toBN((await agentBot.agent.getAgentInfo()).freeCollateralLots);
        // trace({ freeLots, freeLotsAfter, freeLotsAfter2 });
        expect(toBN(freeLotsAfter2).eqn(0)).to.be.true;
        // transfer FAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        const transferFeeMillionths = await context.assetManager.transferFeeMillionths();
        const transferFee = fBalance.mul(transferFeeMillionths).divn(1e6);
        await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
        const balanceBefore = await context.fAsset.balanceOf(redeemer.address);
        await agentBot.agent.claimAndSendTransferFee(redeemer.address);
        const balanceAfter = await context.fAsset.balanceOf(redeemer.address);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(transferFee));
        // update underlying block
        await proveAndUpdateUnderlyingBlock(context.attestationProvider, context.assetManager, ownerAddress);
        // redeemer balance of vault collateral should be 0
        const redBal0 = await vaultCollateralToken.balanceOf(redeemer.address);
        expect(redBal0.eqn(0)).to.be.true;
        //request redemption
        const [rdReqs] = await redeemer.requestRedemption(freeLots.add(freeLotsAfter));
        assert.equal(rdReqs.length, 1);
        const rdReq = rdReqs[0];
        // skip time so the payment will expire on underlying chain and execute redemption default
        chain.skipTimeTo(Number(rdReq.lastUnderlyingTimestamp));
        chain.mine(Number(rdReq.lastUnderlyingBlock));
        const paymentAmount = toBN(rdReq.valueUBA).sub(toBN(rdReq.feeUBA));
        const proof = await redeemer.proveNonPayment(redeemer.underlyingAddress, rdReq.paymentReference, paymentAmount,
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
            const info = await agentBot.agent.getAgentInfo();
            if (!toBN(info.dustUBA).eqn(0)) {
                // move to next epoch so transfer fees will be available for claiming
                const settings = await agentBot.agent.assetManager.transferFeeSettings();
                const epochDuration = settings.epochDuration;
                await time.increase(epochDuration);
                chain.skipTime(Number(epochDuration));
            }
            await updateAgentBotUnderlyingBlockProof(context, agentBot);
            await time.advanceBlock();
            chain.mine();
            await runWithManualFDCFinalization(context, true, () => agentBot.runStep(orm.em));

            // check if agent is not active
            orm.em.clear();
            const agentEnt = await agentBot.fetchAgentEntity(orm.em)
            console.log(`Agent step ${i}, active = ${agentEnt.active}`);
            if (agentEnt.active === false) break;
            assert.isBelow(i, 50);  // prevent infinite loops
        }
    });

    async function readEventsFrom(contract: Truffle.ContractInstance, fromBlock: BlockNumber) {
        const toBlock = await web3.eth.getBlockNumber();
        const eventDecoder = new Web3ContractEventDecoder({ contract });
        const rawEvents = await web3.eth.getPastLogs({ address: contract.address, fromBlock, toBlock });
        return eventDecoder.decodeEvents(rawEvents);
    }

    it("Should respond to agent ping", async () => {
        const trustedPingSenders = [accounts[5]];
        agentBot.agentBotSettings.trustedPingSenders = new Set(trustedPingSenders.map(a => a.toLowerCase()));
        const fromBlock = await web3.eth.getBlockNumber();
        await context.assetManager.agentPing(agentBot.agent.vaultAddress, 0, { from: accounts[5] });
        await agentBot.runStep(orm.em);
        const allEvents = await readEventsFrom(context.assetManager, fromBlock);
        const events = filterEventList(allEvents, context.assetManager, "AgentPingResponse");
        assert.equal(events.length, 1);
        const response = JSON.stringify({ name: "flarelabs/fasset-bots", version: programVersion() });
        assert.equal(events[0].args.response, response);
    });

    it("Should not respond to ping from untrusted providers", async () => {
        const trustedPingSenders = [accounts[5]];
        agentBot.agentBotSettings.trustedPingSenders = new Set(trustedPingSenders.map(a => a.toLowerCase()));
        const fromBlock = await web3.eth.getBlockNumber();
        await context.assetManager.agentPing(agentBot.agent.vaultAddress, 0, { from: accounts[1] });
        await agentBot.runStep(orm.em);
        const allEvents = await readEventsFrom(context.assetManager, fromBlock);
        const events = filterEventList(allEvents, context.assetManager, "AgentPingResponse");
        assert.equal(events.length, 0);
    });

    it("Should claim transfer fees", async () => {
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

        // move to the next transfer fee epoch
        const settings = await agentBot.agent.assetManager.transferFeeSettings();
        const epochDuration = settings.epochDuration;
        // move to next epoch
        await time.increase(epochDuration);

        // run step
        // it should claim transfer fees
        const info = await agentBot.agent.getAgentInfo();
        const poolFeeShareBIPS = info.poolFeeShareBIPS;
        const { 1: count } = await agentBot.agent.assetManager.agentUnclaimedTransferFeeEpochs(agentBot.agent.vaultAddress);
        const agentTransferFeeShare = await agentBot.agent.assetManager.agentTransferFeeShare(agentBot.agent.vaultAddress, count);
        const agentClaimed = agentTransferFeeShare.mul(toBN(1e4).sub(toBN(poolFeeShareBIPS))).div(toBN(1e4));
        const balanceBefore = await context.fAsset.balanceOf(agentBot.agent.owner.workAddress);
        await agentBot.runStep(orm.em);
        const balanceAfter = await context.fAsset.balanceOf(agentBot.agent.owner.workAddress);
        assertWeb3DeepEqual(balanceAfter, balanceBefore.add(agentClaimed));
    });

    it("Should not claim all transfer fees", async () => {
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

        // move to the next transfer fee epoch and transfer fAssets
        const fBalance = await context.fAsset.balanceOf(minter.address);
        const settings = await agentBot.agent.assetManager.transferFeeSettings();
        const epochDuration = settings.epochDuration;
        const amount = 1000000;
        assert.isBelow(amount * 13, Number(fBalance));
        for (let i = 0; i < 13; i++) {
            // move to next epoch
            await context.fAsset.transfer(redeemer.address, amount, { from: minter.address });
            await time.increase(epochDuration);
        }

        const info = await agentBot.agent.getAgentInfo();
        const poolFeeShareBIPS = info.poolFeeShareBIPS;
        // it should claim transfer fees for the first 10 epochs
        const { 1: count } = await agentBot.agent.assetManager.agentUnclaimedTransferFeeEpochs(agentBot.agent.vaultAddress);
        assertWeb3DeepEqual(count, 13);
        let agentTransferFeeShare = await agentBot.agent.assetManager.agentTransferFeeShare(agentBot.agent.vaultAddress, count);
        const feeShare10Epochs = agentTransferFeeShare.mul(toBN(10)).div(toBN(13));
        let agentClaimed = feeShare10Epochs.mul(toBN(1e4).sub(toBN(poolFeeShareBIPS))).div(toBN(1e4));
        const balance1 = await context.fAsset.balanceOf(agentBot.agent.owner.workAddress);
        await agentBot.runStep(orm.em);
        const balance2 = await context.fAsset.balanceOf(agentBot.agent.owner.workAddress);
        assertWeb3DeepEqual(balance2, balance1.add(agentClaimed));
        // it should not claim for the next 2 epochs
        const { 1: count1 } = await agentBot.agent.assetManager.agentUnclaimedTransferFeeEpochs(agentBot.agent.vaultAddress);
        agentTransferFeeShare = await agentBot.agent.assetManager.agentTransferFeeShare(agentBot.agent.vaultAddress, count1);
        agentClaimed = agentTransferFeeShare.mul(toBN(1e4).sub(toBN(poolFeeShareBIPS))).div(toBN(1e4));
        await agentBot.runStep(orm.em);
        const balance3 = await context.fAsset.balanceOf(agentBot.agent.owner.workAddress);
        assertWeb3DeepEqual(balance3, balance2);
        // it should move to the next day and claim the last 2 epochs
        await time.increase(24 * 60 * 60);
        await agentBot.runStep(orm.em);
        const balance4 = await context.fAsset.balanceOf(agentBot.agent.owner.workAddress);
        assertWeb3DeepEqual(balance4, balance3.add(agentClaimed));
    });

    // it.only("Should close after transfer even without redemption", async () => {
    //     const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
    //     // perform minting
    //     const lots = 2;
    //     const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
    //     await updateAgentBotUnderlyingBlockProof(context, agentBot);
    //     await agentBot.runStep(orm.em);
    //     const txHash = await minter.performMintingPayment(crt);
    //     chain.mine(chain.finalizationBlocks + 1);
    //     await minter.executeMinting(crt, txHash);
    //     await agentBot.runStep(orm.em);
    //     // transfer FAssets
    //     const fBalance = await context.fAsset.balanceOf(minter.address);
    //     await context.fAsset.transfer(redeemer.address, fBalance, { from: minter.address });
    //     // exit available
    //     const exitAllowedAt = await agentBot.agent.announceExitAvailable();
    //     await time.increaseTo(exitAllowedAt);
    //     await agentBot.agent.exitAvailable();
    //     // close vault
    //     agentEnt.waitingForDestructionCleanUp = true;
    //     await agentBot.runStep(orm.em);
    //     expect(agentEnt.waitingForDestructionCleanUp).to.be.true;
    //     // transfer underlying assets manually
    //     console.log("transferring manually");
    //     const toReturn = await context.wallet.getBalance(agentEnt.underlyingAddress);
    //     console.log(toReturn.toString());
    //     // await context.fAsset.transfer(redeemer.underlyingAddress, toReturn, { from: agentEnt.vaultAddress });
    //     await context.wallet.addTransaction(agentEnt.underlyingAddress, redeemer.underlyingAddress, toReturn, "redemption");
    //     // assert.equal(await context.fAsset.balanceOf(redeemer.address),
    //     await updateAgentBotUnderlyingBlockProof(context, agentBot);
    //     await time.advanceBlock();
    //     chain.mine();
    //     await agentBot.runStep(orm.em);
    //     orm.em.clear();
    //     console.log("clearing dust");
    //     // clear dust
    //     const info = await agentBot.agent.getAgentInfo();
    //     if (!toBN(info.dustUBA).eqn(0)) {
    //         await agentBot.agent.selfClose((await agentBot.agent.getAgentInfo()).dustUBA);
    //     }
    //     // run agent's steps until destroy is announced
    //     for (let i = 0; ; i++) {
    //         await updateAgentBotUnderlyingBlockProof(context, agentBot);
    //         await time.increase(30);
    //         await time.advanceBlock();
    //         chain.mine();
    //         await agentBot.runStep(orm.em);
    //         // check if destroy is announced
    //         orm.em.clear();
    //         const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentBot.agent.vaultAddress } as FilterQuery<AgentEntity>);
    //         console.log(`Agent step ${i}, waitingForDestructionCleanUp = ${agentEnt.waitingForDestructionCleanUp}`);
    //         if (agentEnt.waitingForDestructionCleanUp === false) break;
    //         assert.isBelow(i, 50);  // prevent infinite loops
    //     }
    //     const info2 = await agentBot.agent.getAgentInfo();
    //     assert.equal(String(info2.totalVaultCollateralWei), "0");
    //     assert.equal(String(info2.totalPoolCollateralNATWei), "0");
    //     const status = Number(info2.status);
    //     assert.equal(status, AgentStatus.DESTROYING);
    // });
});
