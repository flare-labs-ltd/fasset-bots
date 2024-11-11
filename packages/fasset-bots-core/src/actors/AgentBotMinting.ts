import { ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { CollateralReservationDeleted, CollateralReserved, MintingExecuted, SelfMint } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { AgentMinting } from "../entities/agent";
import { AgentHandshakeState, AgentMintingState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { AttestationHelperError, attestationProved } from "../underlying-chain/AttestationHelper";
import { ITransaction, TX_SUCCESS } from "../underlying-chain/interfaces/IBlockChain";
import { AttestationNotProved } from "../underlying-chain/interfaces/IFlareDataConnectorClient";
import { EventArgs } from "../utils/events/common";
import { BN_ZERO, MAX_BIPS, assertNotNull, errorIncluded, messageForExpectedError, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBot } from "./AgentBot";
import { formatArgs } from "../utils/formatting";

type MintingId = { id: number } | { requestId: BN };

export class AgentBotMinting {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
    ) {}

    context = this.agent.context;

    /**
     * Stores received collateral reservation as minting in persistent state and update handshake state to APPROVED (if exists).
     * @param rootEm entity manager
     * @param request event's CollateralReserved arguments
     */
    async mintingStarted(rootEm: EM, request: EventArgs<CollateralReserved>): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            const handshake = await this.bot.handshake.findHandshake(rootEm, { requestId: request.collateralReservationId });
            if (handshake != null) {
                await this.bot.handshake.updateHandshake(rootEm, handshake, {
                    state: AgentHandshakeState.APPROVED
                });
            }
            em.create(
                AgentMinting,
                {
                    state: AgentMintingState.STARTED,
                    agentAddress: this.agent.vaultAddress,
                    agentUnderlyingAddress: this.agent.underlyingAddress,
                    requestId: toBN(request.collateralReservationId),
                    valueUBA: toBN(request.valueUBA),
                    feeUBA: toBN(request.feeUBA),
                    firstUnderlyingBlock: toBN(request.firstUnderlyingBlock),
                    lastUnderlyingBlock: toBN(request.lastUnderlyingBlock),
                    lastUnderlyingTimestamp: toBN(request.lastUnderlyingTimestamp),
                    paymentReference: request.paymentReference,
                    handshake: handshake
                } as RequiredEntityData<AgentMinting>,
                { persist: true }
            );
        });
        await this.notifier.sendMintingStarted(request.collateralReservationId);
        logger.info(`Agent ${this.agent.vaultAddress} started minting ${request.collateralReservationId}.`);
    }

    async mintingExecuted(rootEm: EM, args: EventArgs<MintingExecuted>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} received event 'MintingExecuted' with data ${formatArgs(args)}.`);
        let minting = await this.findMinting(rootEm, { requestId: args.collateralReservationId });
        minting = await this.updateMinting(rootEm, minting, {
            state: AgentMintingState.DONE,
        });
        await this.notifier.sendMintingExecuted(minting.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} closed (executed) minting ${minting.requestId}.`)
    }

    async selfMintingExecuted(args: EventArgs<SelfMint>): Promise<void> {
        if (args.mintFromFreeUnderlying) {
            logger.info(`Agent ${this.agent.vaultAddress} executed self-minting from free underlying.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} executed self-minting.`);
        }
    }

    async mintingDeleted(rootEm: EM, args: EventArgs<CollateralReservationDeleted>) {
        let minting = await this.findMinting(rootEm, { requestId: args.collateralReservationId });
        minting = await this.updateMinting(rootEm, minting, {
            state: AgentMintingState.DONE,
        });
        await this.notifier.sendMintingDeleted(minting.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} closed (deleted) minting ${minting.requestId}.`);
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenMintings(rootEm: EM): Promise<void> {
        try {
            const openMintings = await this.openMintings(rootEm, true);
            logger.info(`Agent ${this.agent.vaultAddress} started handling open mintings #${openMintings.length}.`);
            for (const rd of openMintings) {
                /* istanbul ignore next */
                if (this.bot.stopRequested()) return;
                await this.nextMintingStep(rootEm, rd.id);
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished handling open mintings.`);
        } catch (error) {
            console.error(`Error while handling open mintings for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling open mintings:`, error);
        }
    }

    /**
     * Returns minting with state other than DONE.
     * @param em entity manager
     * @param onlyIds if true, only AgentMinting's entity ids are return
     * @return list of AgentMinting's instances
     */
    async openMintings(em: EM, onlyIds: boolean): Promise<AgentMinting[]> {
        let query = em.createQueryBuilder(AgentMinting);
        if (onlyIds) query = query.select("id");
        return await query
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ $not: { state: AgentMintingState.DONE } })
            .getResultList();
    }

    /**
     * Handles mintings stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentMinting's entity id
     */
    async nextMintingStep(rootEm: EM, id: number): Promise<void> {
        try {
            const minting = await this.findMinting(rootEm, { id });
            logger.info(`Agent ${this.agent.vaultAddress} is handling open minting ${minting.requestId} in state ${minting.state}.`);
            switch (minting.state) {
                case AgentMintingState.STARTED:
                    await this.checkForNonPaymentProofOrExpiredProofs(rootEm, minting);
                    break;
                case AgentMintingState.REQUEST_NON_PAYMENT_PROOF:
                    await this.checkNonPayment(rootEm, minting);
                    break;
                case AgentMintingState.REQUEST_PAYMENT_PROOF:
                    await this.checkPaymentAndExecuteMinting(rootEm, minting);
                    break;
                default:
                    console.error(`Minting state: ${minting.state} not supported`);
                    logger.error(`Agent ${this.agent.vaultAddress} run into minting state ${minting.state} not supported for minting ${minting.requestId}.`);
            }
        } catch (error) {
            console.error(`Error handling next minting step for minting ${id} agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling handling next minting step for minting ${id}:`, error);
            if (errorIncluded(error, ["invalid crt id"])) {
                const minting = await this.findMinting(rootEm, { id });
                await this.updateMinting(rootEm, minting, {
                    state: AgentMintingState.DONE,
                });
                logger.error(`Agent ${this.agent.vaultAddress} closed minting ${id} due to "invalid crt id"`);
                console.error(`Agent ${this.agent.vaultAddress} closed minting ${id} due to "invalid crt id"`);
            }
        }
    }

    /**
     * When minting is in state STARTED, it checks if underlying payment proof for collateral reservation expired in indexer.
     * Then it calls the appropriate handling method.
     * @param minting AgentMinting entity
     */
    async checkForNonPaymentProofOrExpiredProofs(rootEm: EM, minting: Readonly<AgentMinting>): Promise<void> {
        const proof = await this.bot.checkProofExpiredInIndexer(toBN(minting.lastUnderlyingBlock), toBN(minting.lastUnderlyingTimestamp));
        if (proof === "NOT_EXPIRED") {
            // payment/non-payment proof can be obtained
            await this.handleOpenMinting(rootEm, minting);
        } else if (typeof proof === "object") {
            // corner case: proof expires in indexer
            await this.handleExpiredMinting(rootEm, minting, proof);
        }
    }

    /**
     * Check if time for payment expired on underlying. If if did not expire, then it does nothing.
     * If time for payment expired, it checks via indexer if transaction for payment exists.
     * If it does exists, then it requests for payment proof - see requestPaymentProofForMinting().
     * If it does not exist, then it request non payment proof - see requestNonPaymentProofForMinting().
     * @param minting AgentMinting entity
     */
    async handleOpenMinting(rootEm: EM, minting: Readonly<AgentMinting>) {
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        const latestBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
        // wait times expires on underlying + finalizationBlock
        if (latestBlock && Number(minting.lastUnderlyingBlock) + 1 + this.context.blockchainIndexer.finalizationBlocks < latestBlock.number) {
            // time for payment expired on underlying
            logger.info(`Agent ${this.agent.vaultAddress} waited that time for underlying payment expired for minting ${minting.requestId}.`);
            const txs = await this.agent.context.blockchainIndexer.getTransactionsByReference(minting.paymentReference);
            const successfulTxs = txs.filter(tx => this.isSuccessfulPayment(minting, tx));
            if (successfulTxs.length >= 1) {
                const tx = successfulTxs[0];
                const txHash = tx.hash;
                // corner case: minter pays and doesn't execute minting
                // check minter paid -> request payment proof -> execute minting
                const sourceAddress = tx.inputs[0][0];
                logger.info(`Agent ${this.agent.vaultAddress} found payment transaction ${txHash} for minting ${minting.requestId}.`);
                await this.requestPaymentProofForMinting(rootEm, minting, txHash, sourceAddress);
            } else {
                // just log failed transactions
                for (const tx of txs) {
                    logger.info(`Agent ${this.agent.vaultAddress} found FAILED payment transaction ${tx.hash} for minting ${minting.requestId}.`);
                }
                // minter did not pay -> request non payment proof -> unstick minting
                logger.info(`Agent ${this.agent.vaultAddress} did NOT find successful payment transactions for minting ${minting.requestId}.`);
                await this.requestNonPaymentProofForMinting(rootEm, minting);
            }
        }
    }

    isSuccessfulPayment(minting: Readonly<AgentMinting>, tx: ITransaction) {
        const targetAmount = tx.outputs
            .filter(([dst, amount]) => dst === minting.agentUnderlyingAddress)
            .reduce((x, [dst, amount]) => x.add(toBN(amount)), BN_ZERO);
        return tx.status === TX_SUCCESS
            && targetAmount.gte(minting.valueUBA.add(minting.feeUBA))
            && tx.reference?.toLowerCase() === minting.paymentReference?.toLowerCase();
    }

    /**
     * Since proof expired (corner case), it calls unstickMinting, sets the state of minting in persistent state as DONE and send notification to owner.
     * @param minting AgentMinting entity
     * @param proof The proof that payment and non-payment proofs for the minting have expired
     */
    async handleExpiredMinting(rootEm: EM, minting: Readonly<AgentMinting>, proof: ConfirmedBlockHeightExists.Proof) {
        logger.info(`Agent ${this.agent.vaultAddress} is calling 'unstickMinting' ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
        const settings = await this.context.assetManager.getSettings();
        const natPriceConverter = await this.agent.getPoolCollateralPrice(settings);
        const burnNats = natPriceConverter.convertUBAToTokenWei(toBN(minting.valueUBA))
            .mul(toBN(settings.vaultCollateralBuyForFlareFactorBIPS)).divn(MAX_BIPS);
        await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
            await this.context.assetManager.unstickMinting(web3DeepNormalize(proof), toBN(minting.requestId), { from: this.agent.owner.workAddress, value: burnNats });
        });
        minting = await this.updateMinting(rootEm, minting, {
            state: AgentMintingState.DONE,
        });
        await this.notifier.sendMintingIndexerExpired(minting.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} unstuck minting ${minting.requestId}.`);
    }

    /**
     * Sends request for minting payment proof, sets state for minting in persistent state to REQUEST_PAYMENT_PROOF and sends notification to owner,
     * @param minting AgentMinting entity
     * @param txHash transaction hash for minting payment
     * @param sourceAddress minter's underlying address
     */
    async requestPaymentProofForMinting(rootEm: EM, minting: Readonly<AgentMinting>, txHash: string, sourceAddress: string): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for payment proof for transaction ${txHash} and minting ${minting.requestId}.`);
        try {
            const request = await this.bot.locks.nativeChainLock(this.bot.requestSubmitterAddress()).lockAndRun(async () => {
                return await this.context.attestationProvider.requestPaymentProof(txHash, sourceAddress, this.agent.underlyingAddress);
            });
            minting = await this.updateMinting(rootEm, minting, {
                state: AgentMintingState.REQUEST_PAYMENT_PROOF,
                proofRequestRound: request.round,
                proofRequestData: request.data,
            });
            await this.notifier.sendMintingPaymentProofRequested(minting.requestId);
            logger.info(`Agent ${this.agent.vaultAddress} requested payment proof for transaction ${txHash} and minting ${minting.requestId}; source underlying address ${sourceAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } catch (error) {
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet request payment proof for transaction ${txHash} and minting ${minting.requestId}:`,
                messageForExpectedError(error, [AttestationHelperError]));
        }
    }

    /**
     * Sends request for minting non payment proof, sets state for minting in persistent state to REQUEST_NON_PAYMENT_PROOF and sends notification to owner,
     * @param minting AgentMinting entity
     */
    async requestNonPaymentProofForMinting(rootEm: EM, minting: Readonly<AgentMinting>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for non payment proof for minting ${minting.requestId}.`);
        try {
            const request = await this.bot.locks.nativeChainLock(this.bot.requestSubmitterAddress()).lockAndRun(async () => {
                return await this.context.attestationProvider.requestReferencedPaymentNonexistenceProof(
                    minting.agentUnderlyingAddress, minting.paymentReference, toBN(minting.valueUBA).add(toBN(minting.feeUBA)),
                    Number(minting.firstUnderlyingBlock), Number(minting.lastUnderlyingBlock), Number(minting.lastUnderlyingTimestamp),
                    minting.handshake?.minterUnderlyingAddresses);
            });
            minting = await this.updateMinting(rootEm, minting, {
                state: AgentMintingState.REQUEST_NON_PAYMENT_PROOF,
                proofRequestRound: request.round,
                proofRequestData: request.data,
            });
            await this.notifier.sendMintingNonPaymentProofRequested(minting.requestId);
            logger.info(`Agent ${this.agent.vaultAddress} requested non payment proof for minting ${minting.requestId}; reference ${minting.paymentReference}, target underlying address ${minting.agentUnderlyingAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } catch (error) {
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet prove non payment proof for minting ${minting.requestId}:`,
                messageForExpectedError(error, [AttestationHelperError]));
        }
    }

    /**
     * When minting is in state REQUEST_NON_PAYMENT_PROOF, it obtains non payment proof, calls mintingPaymentDefault and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     * @param minting AgentMinting entity
     */
    async checkNonPayment(rootEm: EM, minting: Readonly<AgentMinting>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
        assertNotNull(minting.proofRequestRound);
        assertNotNull(minting.proofRequestData);
        const proof = await this.context.attestationProvider.obtainReferencedPaymentNonexistenceProof(minting.proofRequestRound, minting.proofRequestData)
            .catch(e => {
                logger.error(`Error obtaining non-payment proof for minting ${minting.requestId}:`, e);
                return null;
            });
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(`Agent ${this.agent.vaultAddress}: proof not yet finalized for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            return;
        }
        if (attestationProved(proof)) {
            logger.info(`Agent ${this.agent.vaultAddress} obtained non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                await this.context.assetManager.mintingPaymentDefault(web3DeepNormalize(proof), minting.requestId, { from: this.agent.owner.workAddress });
            });
            minting = await this.updateMinting(rootEm, minting, {
                state: AgentMintingState.DONE,
            });
            logger.info(`Agent ${this.agent.vaultAddress} executed minting payment default for minting ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
            await this.notifier.sendMintingDefaultSuccess(minting.requestId);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            // wait for one more round and then reset to state STARTED, which will eventually resubmit request
            if (await this.bot.enoughTimePassedToObtainProof(minting)) {
                await this.notifier.sendMintingDefaultFailure(minting.requestId, minting.proofRequestRound, minting.proofRequestData);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining non payment proof for minting ${minting.requestId}.`);
                minting = await this.updateMinting(rootEm, minting, {
                    state: AgentMintingState.STARTED,
                    proofRequestRound: undefined,
                    proofRequestData: undefined,
                });
            }
        }
    }

    /**
     * When minting is in state REQUEST_PAYMENT_PROOF, it obtains payment proof, calls executeMinting and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     * @param minting AgentMinting entity
     */
    async checkPaymentAndExecuteMinting(rootEm: EM, minting: Readonly<AgentMinting>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
        assertNotNull(minting.proofRequestRound);
        assertNotNull(minting.proofRequestData);
        const proof = await this.context.attestationProvider.obtainPaymentProof(minting.proofRequestRound, minting.proofRequestData)
            .catch(e => {
                logger.error(`Error obtaining payment proof for minting ${minting.requestId}:`, e);
                return null;
            });
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(`Agent ${this.agent.vaultAddress}: proof not yet finalized for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            return;
        }
        if (attestationProved(proof)) {
            logger.info(`Agent ${this.agent.vaultAddress} obtained payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                await this.context.assetManager.executeMinting(web3DeepNormalize(proof), minting.requestId, { from: this.agent.owner.workAddress });
            });
            minting = await this.updateMinting(rootEm, minting, {
                state: AgentMintingState.DONE,
            });
            logger.info(`Agent ${this.agent.vaultAddress} executed minting ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain payment proof for minting ${minting.requestId} with in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            // wait for one more round and then reset to state STARTED, which will eventually resubmit request
            if (await this.bot.enoughTimePassedToObtainProof(minting)) {
                await this.notifier.sendMintingNoProofObtained(minting.requestId, minting.proofRequestRound, minting.proofRequestData);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining payment proof for minting ${minting.requestId}.`);
                minting = await this.updateMinting(rootEm, minting, {
                    state: AgentMintingState.STARTED,
                    proofRequestRound: undefined,
                    proofRequestData: undefined,
                });
            }
        }
    }

    /**
     * Load and update minting object in its own transaction.
     */
    async updateMinting(rootEm: EM, mintingId: MintingId, modifications: Partial<AgentMinting>): Promise<AgentMinting> {
        return await this.bot.runInTransaction(rootEm, async (em) => {
            const minting = await this.findMinting(em, mintingId);
            Object.assign(minting, modifications);
            return minting;
        });
    }

    /**
     * Returns minting by required id from persistent state.
     * @param em entity manager
     * @param mintingId either db id or collateral reservation id
     * @returns instance of AgentMinting
     */
    async findMinting(em: EM, mintingId: MintingId): Promise<AgentMinting> {
        if ("id" in mintingId) {
            return await em.findOneOrFail(AgentMinting, { id: mintingId.id }, { refresh: true });
        } else {
            return await em.findOneOrFail(AgentMinting, { agentAddress: this.agent.vaultAddress, requestId: mintingId.requestId }, { refresh: true });
        }
    }
}
