import { ConfirmedBlockHeightExists } from "@flarenetwork/state-connector-protocol";
import { FilterQuery, RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { CollateralReserved } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { AgentMinting, AgentMintingState } from "../entities/agent";
import { Agent } from "../fasset/Agent";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { AttestationNotProved } from "../underlying-chain/interfaces/IStateConnectorClient";
import { EventArgs } from "../utils/events/common";
import { MAX_BIPS, assertNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { web3DeepNormalize } from "../utils/web3normalize";
import { AgentBot } from "./AgentBot";

export class AgentBotMinting {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
    ) {}

    context = this.agent.context;

    /**
     * Stores received collateral reservation as minting in persistent state.
     * @param em entity manager
     * @param request event's CollateralReserved arguments
     */
    async mintingStarted(em: EM, request: EventArgs<CollateralReserved>): Promise<void> {
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
            } as RequiredEntityData<AgentMinting>,
            { persist: true }
        );
        await this.notifier.sendMintingStarted(request.collateralReservationId);
        logger.info(`Agent ${this.agent.vaultAddress} started minting ${request.collateralReservationId}.`);
    }

    /**
     * Returns minting by required id from persistent state.
     * @param em entity manager
     * @param requestId collateral reservation id
     * @returns instance of AgentMinting
     */
    async findMinting(em: EM, requestId: BN): Promise<AgentMinting> {
        const agentAddress = this.agent.vaultAddress;
        return await em.findOneOrFail(AgentMinting, { agentAddress, requestId } as FilterQuery<AgentMinting>);
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
     * Marks stored minting in persistent state as DONE.
     * @param minting AgentMinting entity
     * @param executed if true, notifies about executed minting, otherwise notifies about deleted minting
     */
    async mintingExecuted(minting: AgentMinting, executed: boolean): Promise<void> {
        minting.state = AgentMintingState.DONE;
        if (executed) {
            await this.notifier.sendMintingExecuted(minting.requestId);
            logger.info(`Agent ${this.agent.vaultAddress} closed (executed) minting ${minting.requestId}.`);
        } else {
            await this.notifier.sendMintingDeleted(minting.requestId);
            logger.info(`Agent ${this.agent.vaultAddress} closed (deleted) minting ${minting.requestId}.`);
        }
    }

    /**
     * Handles mintings stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentMinting's entity id
     */
    async nextMintingStep(rootEm: EM, id: number): Promise<void> {
        await rootEm
            .transactional(async (em) => {
                const minting = await em.getRepository(AgentMinting).findOneOrFail({ id: Number(id) } as FilterQuery<AgentMinting>);
                logger.info(`Agent ${this.agent.vaultAddress} is handling open minting ${minting.requestId} in state ${minting.state}.`);
                switch (minting.state) {
                    case AgentMintingState.STARTED:
                        await this.checkForNonPaymentProofOrExpiredProofs(minting);
                        break;
                    case AgentMintingState.REQUEST_NON_PAYMENT_PROOF:
                        await this.checkNonPayment(minting);
                        break;
                    case AgentMintingState.REQUEST_PAYMENT_PROOF:
                        await this.checkPaymentAndExecuteMinting(minting);
                        break;
                    default:
                        console.error(`Minting state: ${minting.state} not supported`);
                        logger.error(`Agent ${this.agent.vaultAddress} run into minting state ${minting.state} not supported for minting ${minting.requestId}.`);
                }
            })
            .catch((error) => {
                console.error(`Error handling next minting step for minting ${id} agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling handling next minting step for minting ${id}:`, error);
            });
    }

    /**
     * When minting is in state STARTED, it checks if underlying payment proof for collateral reservation expired in indexer.
     * Then it calls the appropriate handling method.
     * @param minting AgentMinting entity
     */
    async checkForNonPaymentProofOrExpiredProofs(minting: AgentMinting): Promise<void> {
        const proof = await this.bot.checkProofExpiredInIndexer(toBN(minting.lastUnderlyingBlock), toBN(minting.lastUnderlyingTimestamp));
        if (proof === "NOT_EXPIRED") {
            // payment/non-payment proof can be obtained
            await this.handleOpenMinting(minting);
        } else if (typeof proof === "object") {
            // corner case: proof expires in indexer
            await this.handleExpiredMinting(minting, proof);
        }
    }

    /**
     * Check if time for payment expired on underlying. If if did not expire, then it does nothing.
     * If time for payment expired, it checks via indexer if transaction for payment exists.
     * If it does exists, then it requests for payment proof - see requestPaymentProofForMinting().
     * If it does not exist, then it request non payment proof - see requestNonPaymentProofForMinting().
     * @param minting AgentMinting entity
     */
    async handleOpenMinting(minting: AgentMinting) {
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        const latestBlock = await this.context.blockchainIndexer.getBlockAt(blockHeight);
        // wait times expires on underlying + finalizationBlock
        if (latestBlock && Number(minting.lastUnderlyingBlock) + 1 + this.context.blockchainIndexer.finalizationBlocks < latestBlock.number) {
            // time for payment expired on underlying
            logger.info(`Agent ${this.agent.vaultAddress} waited that time for underlying payment expired for minting ${minting.requestId}.`);
            const txs = await this.agent.context.blockchainIndexer.getTransactionsByReference(minting.paymentReference);
            /* istanbul ignore else */
            if (txs.length === 1) {
                // corner case: minter pays and doesn't execute minting
                // check minter paid -> request payment proof -> execute minting
                const txHash = txs[0].hash;
                // TODO is it ok to check first address in UTXO chains?
                const sourceAddress = txs[0].inputs[0][0];
                logger.info(`Agent ${this.agent.vaultAddress} found payment transaction ${txHash} for minting ${minting.requestId}.`);
                await this.requestPaymentProofForMinting(minting, txHash, sourceAddress);
            } else if (txs.length === 0) {
                // minter did not pay -> request non payment proof -> unstick minting
                logger.info(`Agent ${this.agent.vaultAddress} did NOT found payment transaction for minting ${minting.requestId}.`);
                await this.requestNonPaymentProofForMinting(minting);
            }
        }
    }

    /**
     * Since proof expired (corner case), it calls unstickMinting, sets the state of minting in persistent state as DONE and send notification to owner.
     * @param minting AgentMinting entity
     * @param proof The proof that payment and non-payment proofs for the minting have expired
     */
    async handleExpiredMinting(minting: AgentMinting, proof: ConfirmedBlockHeightExists.Proof) {
        logger.info(`Agent ${this.agent.vaultAddress} is calling 'unstickMinting' ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
        const settings = await this.context.assetManager.getSettings();
        const natPriceConverter = await this.agent.getPoolCollateralPrice();
        const burnNats = natPriceConverter.convertUBAToTokenWei(toBN(minting.valueUBA)).mul(toBN(settings.vaultCollateralBuyForFlareFactorBIPS)).divn(MAX_BIPS);
        // TODO what to do if owner does not have enough nat
        await this.context.assetManager.unstickMinting(web3DeepNormalize(proof), toBN(minting.requestId), {
            from: this.agent.owner.workAddress,
            value: burnNats,
        });
        minting.state = AgentMintingState.DONE;
        await this.notifier.sendMintingIndexerExpired(minting.requestId);
        logger.info(`Agent ${this.agent.vaultAddress} unstuck minting ${minting.requestId}.`);
    }

    /**
     * Sends request for minting payment proof, sets state for minting in persistent state to REQUEST_PAYMENT_PROOF and sends notification to owner,
     * @param minting AgentMinting entity
     * @param txHash transaction hash for minting payment
     * @param sourceAddress minter's underlying address
     */
    async requestPaymentProofForMinting(minting: AgentMinting, txHash: string, sourceAddress: string): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for payment proof for transaction ${txHash} and minting ${minting.requestId}.`);
        const request = await this.context.attestationProvider.requestPaymentProof(txHash, sourceAddress, this.agent.underlyingAddress);
        if (request) {
            minting.state = AgentMintingState.REQUEST_PAYMENT_PROOF;
            minting.proofRequestRound = request.round;
            minting.proofRequestData = request.data;
            await this.notifier.sendMintingPaymentProofRequested(minting.requestId);
            logger.info(`Agent ${this.agent.vaultAddress} requested payment proof for transaction ${txHash} and minting ${minting.requestId}; source underlying address ${sourceAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {
            // else cannot prove request yet
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet request payment proof for transaction ${txHash} and minting ${minting.requestId}.`);
        }
    }

    /**
     * Sends request for minting non payment proof, sets state for minting in persistent state to REQUEST_NON_PAYMENT_PROOF and sends notification to owner,
     * @param minting AgentMinting entity
     */
    async requestNonPaymentProofForMinting(minting: AgentMinting): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is sending request for non payment proof for minting ${minting.requestId}.`);
        const request = await this.context.attestationProvider.requestReferencedPaymentNonexistenceProof(
            minting.agentUnderlyingAddress,
            minting.paymentReference,
            toBN(minting.valueUBA).add(toBN(minting.feeUBA)),
            Number(minting.firstUnderlyingBlock),
            Number(minting.lastUnderlyingBlock),
            Number(minting.lastUnderlyingTimestamp)
        );
        if (request) {
            minting.state = AgentMintingState.REQUEST_NON_PAYMENT_PROOF;
            minting.proofRequestRound = request.round;
            minting.proofRequestData = request.data;
            await this.notifier.sendMintingNonPaymentProofRequested(minting.requestId);
            logger.info(`Agent ${this.agent.vaultAddress} requested non payment proof for minting ${minting.requestId}; reference ${minting.paymentReference}, target underlying address ${minting.agentUnderlyingAddress}, proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } else {
            // else cannot prove request yet
            logger.info(`Agent ${this.agent.vaultAddress} cannot yet prove non payment proof for minting ${minting.requestId}.`);
        }
    }

    /**
     * When minting is in state REQUEST_NON_PAYMENT_PROOF, it obtains non payment proof, calls mintingPaymentDefault and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     * @param minting AgentMinting entity
     */
    async checkNonPayment(minting: AgentMinting): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
        assertNotNull(minting.proofRequestRound);
        assertNotNull(minting.proofRequestData);
        const proof = await this.context.attestationProvider.obtainReferencedPaymentNonexistenceProof(minting.proofRequestRound, minting.proofRequestData);
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(`Agent ${this.agent.vaultAddress}: proof not yet finalized for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            return;
        }
        if (attestationProved(proof)) {
            logger.info(`Agent ${this.agent.vaultAddress} obtained non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            const nonPaymentProof = proof;
            await this.context.assetManager.mintingPaymentDefault(web3DeepNormalize(nonPaymentProof), minting.requestId, { from: this.agent.owner.workAddress });
            minting.state = AgentMintingState.DONE;
            await this.mintingExecuted(minting, true);
            logger.info(`Agent ${this.agent.vaultAddress} executed minting payment default for minting ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(nonPaymentProof))}.`);
            await this.notifier.sendMintingDefaultSuccess(minting.requestId);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain non payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            await this.notifier.sendMintingDefaultFailure(minting.requestId, minting.proofRequestRound, minting.proofRequestData);
        }
    }

    /**
     * When minting is in state REQUEST_PAYMENT_PROOF, it obtains payment proof, calls executeMinting and sets minting in persistent state to DONE.
     * If proof cannot be obtained, it sends notification to owner.
     * @param minting AgentMinting entity
     */
    async checkPaymentAndExecuteMinting(minting: AgentMinting): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
        assertNotNull(minting.proofRequestRound);
        assertNotNull(minting.proofRequestData);
        const proof = await this.context.attestationProvider.obtainPaymentProof(minting.proofRequestRound, minting.proofRequestData);
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(`Agent ${this.agent.vaultAddress}: proof not yet finalized for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            return;
        }
        if (attestationProved(proof)) {
            logger.info(`Agent ${this.agent.vaultAddress} obtained payment proof for minting ${minting.requestId} in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            const paymentProof = proof;
            await this.context.assetManager.executeMinting(web3DeepNormalize(paymentProof), minting.requestId, { from: this.agent.owner.workAddress });
            minting.state = AgentMintingState.DONE;
            logger.info(`Agent ${this.agent.vaultAddress} executed minting ${minting.requestId} with proof ${JSON.stringify(web3DeepNormalize(paymentProof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain payment proof for minting ${minting.requestId} with in round ${minting.proofRequestRound} and data ${minting.proofRequestData}.`);
            await this.notifier.sendMintingNoProofObtained(minting.requestId, minting.proofRequestRound, minting.proofRequestData);
        }
    }
}
