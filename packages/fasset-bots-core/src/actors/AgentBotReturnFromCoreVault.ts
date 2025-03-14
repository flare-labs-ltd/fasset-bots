import { RequiredEntityData } from "@mikro-orm/core";
import { ReturnFromCoreVaultRequested } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { ReturnFromCoreVault } from "../entities/agent";
import { ReturnFromCoreVaultState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { EventArgs } from "../utils/events/common";
import { assertNotNull, messageForExpectedError, requireNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentBot } from "./AgentBot";
import { squashSpace, web3DeepNormalize } from "../utils";
import { ITransaction } from "../underlying-chain/interfaces/IBlockChain";
import { AttestationHelperError, attestationProved } from "../underlying-chain/AttestationHelper";
import { AttestationNotProved } from "../underlying-chain/interfaces/IFlareDataConnectorClient";

export class AgentBotReturnFromCoreVault {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
    ) {}

    context = this.agent.context;

    /**
     * Stores received return from core vault request in persistent state.
     * @param em entity manager
     * @param request event's ReturnFromCoreVaultRequested arguments
     */
    async returnFromCoreVaultStarted(rootEm: EM, request: EventArgs<ReturnFromCoreVaultRequested>): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            em.create(
                ReturnFromCoreVault,
                {
                    state: ReturnFromCoreVaultState.STARTED,
                    agentAddress: this.agent.vaultAddress,
                    valueUBA: toBN(request.valueUBA),
                    paymentReference: this.agent.vaultAddress, // TODO - change to reference from event
                } as RequiredEntityData<ReturnFromCoreVault>,
                { persist: true }
            );
        });
        await this.notifier.sendReturnFromCVStarted();
        logger.info(`Agent ${this.agent.vaultAddress} started return from core vault.`);
    }

    async returnFromCoreVaultConfirmed(rootEm: EM): Promise<void> {
        const returnFromCoreVault = await this.getLatestOpenReturnFromCoreVault(rootEm, this.agent.vaultAddress);
        if (returnFromCoreVault) {
            await this.updateReturnFromCoreVault(rootEm, returnFromCoreVault, {
                state: ReturnFromCoreVaultState.DONE,
            });
            await this.notifier.sendReturnFromCVPerformed();
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} confirmed return from core vault.`);
        }
   }

    async returnFromCoreVaultCancelled(rootEm: EM) {
        const returnFromCoreVault = await this.getLatestOpenReturnFromCoreVault(rootEm, this.agent.vaultAddress);
        if (returnFromCoreVault === null) {
            logger.warn(`Agent ${this.agent.vaultAddress} cannot cancelled and closed return from core vault. No open returns from core vault.`);
            return;
        }
        await this.updateReturnFromCoreVault(rootEm, returnFromCoreVault, {
            state: ReturnFromCoreVaultState.DONE,
            cancelled: true
        });
        await this.notifier.sendReturnFromCVCancelled();
        logger.info(`Agent ${this.agent.vaultAddress} cancelled and closed return from core vault.`);
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenReturnsFromCoreVault(rootEm: EM): Promise<void> {
        try {
            const openOpenFromCoreVault = await this.getLatestOpenReturnFromCoreVault(rootEm, this.agent.vaultAddress);
            if (openOpenFromCoreVault === null) {
                logger.info(`Agent ${this.agent.vaultAddress} will not handle open returns from core vault - #0.`);
                return;
            }
            logger.info(`Agent ${this.agent.vaultAddress} started handling open returns from core vault #1.`);
            if (this.bot.stopRequested()) return;
            await this.nextReturnFromCoreVaultStep(rootEm, openOpenFromCoreVault);
            logger.info(`Agent ${this.agent.vaultAddress} finished handling open returns from core vault.`);
        } catch (error) {
            console.error(`Error while handling open returns from core vault for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling open returns from core vault:`, error);
        }
    }

    async nextReturnFromCoreVaultStep(rootEm: EM, returnFromCoreVault: Readonly<ReturnFromCoreVault>) {
        switch (returnFromCoreVault.state) {
            case ReturnFromCoreVaultState.STARTED:
                await this.checkPaymentProofAvailable(rootEm, returnFromCoreVault);
                break;
            case ReturnFromCoreVaultState.REQUESTED_PROOF:
                await this.checkConfirmPayment(rootEm, returnFromCoreVault);
                break;
            default:
                console.error(`ReturnFromCoreVault state: ${returnFromCoreVault.state} not supported`);
                logger.error(`Agent ${this.agent.vaultAddress} run into ReturnFromCoreVault state ${returnFromCoreVault.state} not supported for return from core vault ${returnFromCoreVault.id}.`);
        }
    }

    /**
     * Check underlying indexer if payment transaction from core vault is seen
     */
    async checkPaymentProofAvailable(rootEm: EM, returnFromCoreVault: Readonly<ReturnFromCoreVault>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is checking if payment proof for ReturnFromCoreVault ${returnFromCoreVault.id} is available.`);
        const coreVaultSourceAddress = await requireNotNull(this.context.coreVaultManager).coreVaultAddress();
        if (!returnFromCoreVault.txHash) { //returnFromCoreVault.txHash will already be defined if proof will be obtained for the second time
            let txFound: ITransaction | null = null;
            const txs = await this.context.blockchainIndexer.getTransactionsByReference(returnFromCoreVault.paymentReference);
            for (const tx of txs) {
                const paymentValid = tx.inputs.some(([address, _]) => address === coreVaultSourceAddress)
                    && tx.outputs.some(([address, _]) => address === this.agent.underlyingAddress)
                    && tx.reference?.toLowerCase() === returnFromCoreVault.paymentReference?.toLowerCase();
                if (paymentValid) {
                    txFound = tx;
                    break;
                }
            }
            if (txFound === null) {
                logger.info(`Agent ${this.agent.vaultAddress} cannot yet find transaction with payment reference ${returnFromCoreVault.paymentReference}.`);
                return;
            } else {
                returnFromCoreVault = await this.updateReturnFromCoreVault(rootEm, returnFromCoreVault, {
                    txHash: txFound.hash
                });
            }
        }
        await this.requestPaymentProof(rootEm, returnFromCoreVault);
        await this.notifier.sendReturnFromCVRequestPaymentProof(returnFromCoreVault.id.toString(), returnFromCoreVault.paymentReference);
    }


    async requestPaymentProof(rootEm: EM, returnFromCoreVault: Readonly<ReturnFromCoreVault>): Promise<void> {
        logger.info(squashSpace`Agent ${this.agent.vaultAddress} is sending request for payment proof transaction ${returnFromCoreVault.txHash}
            and return from core vault ${returnFromCoreVault.id}.`);
        const txHash = requireNotNull(returnFromCoreVault.txHash);
        try {
            const request = await this.bot.locks.nativeChainLock(this.bot.requestSubmitterAddress()).lockAndRun(async () => {
                return await this.context.attestationProvider.requestPaymentProof(txHash, null, this.agent.underlyingAddress);
            });
            returnFromCoreVault = await this.updateReturnFromCoreVault(rootEm, returnFromCoreVault, {
                state: ReturnFromCoreVaultState.REQUESTED_PROOF,
                proofRequestRound: request.round,
                proofRequestData: request.data,
            });
            logger.info(squashSpace`Agent ${this.agent.vaultAddress} requested payment proof for transaction ${txHash}
                and return from core vault ${returnFromCoreVault.id};
                proofRequestRound ${request.round}, proofRequestData ${request.data}`);
        } catch (error) {
            logger.error(`Agent ${this.agent.vaultAddress} cannot yet request payment proof for transaction ${txHash} and return from core vault ${returnFromCoreVault.id}.`,
                messageForExpectedError(error, [AttestationHelperError]));
        }
    }

    async checkConfirmPayment(rootEm: EM, returnFromCoreVault: Readonly<ReturnFromCoreVault>): Promise<void> {
        logger.info(`Agent ${this.agent.vaultAddress} is trying to obtain payment proof for return from core vault ${returnFromCoreVault.id} in round ${returnFromCoreVault.proofRequestRound} and data ${returnFromCoreVault.proofRequestData}.`);
        assertNotNull(returnFromCoreVault.proofRequestRound);
        assertNotNull(returnFromCoreVault.proofRequestData);
        const proof = await this.context.attestationProvider.obtainPaymentProof(returnFromCoreVault.proofRequestRound, returnFromCoreVault.proofRequestData)
            .catch(e => {
                logger.error(`Error obtaining payment proof for return from core vault ${returnFromCoreVault.id}:`, e);
                return null;
            });
        if (proof === AttestationNotProved.NOT_FINALIZED) {
            logger.info(`Agent ${this.agent.vaultAddress}: proof not yet finalized for return from core vault ${returnFromCoreVault.id} in round ${returnFromCoreVault.proofRequestRound} and data ${returnFromCoreVault.proofRequestData}.`);
            return;
        }
        if (attestationProved(proof)) {
            logger.info(`Agent ${this.agent.vaultAddress} obtained payment proof for return from core vault ${returnFromCoreVault.id} in round ${returnFromCoreVault.proofRequestRound} and data ${returnFromCoreVault.proofRequestData}.`);
            await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                await this.context.assetManager.confirmReturnFromCoreVault(web3DeepNormalize(proof), this.agent.vaultAddress, { from: this.agent.owner.workAddress });
            });
            returnFromCoreVault = await this.updateReturnFromCoreVault(rootEm, returnFromCoreVault, {
                state: ReturnFromCoreVaultState.DONE,
            });
            await this.notifier.sendReturnFromCVPerformed();
            logger.info(`Agent ${this.agent.vaultAddress} confirmed return from core vault payment for ${returnFromCoreVault.id} with proof ${JSON.stringify(web3DeepNormalize(proof))}.`);
        } else {
            logger.info(`Agent ${this.agent.vaultAddress} cannot obtain payment proof for return from core vault ${returnFromCoreVault.id} in round ${returnFromCoreVault.proofRequestRound} and data ${returnFromCoreVault.proofRequestData}.`);
            // wait for one more round and then reset to state PAID, which will eventually resubmit request
            if (await this.bot.enoughTimePassedToObtainProof(returnFromCoreVault)) {
                await this.notifier.sendRedemptionNoProofObtained(returnFromCoreVault.id, returnFromCoreVault.proofRequestRound, returnFromCoreVault.proofRequestData);
                logger.info(`Agent ${this.agent.vaultAddress} will retry obtaining proof of payment for return from core vault ${returnFromCoreVault.id}.`);
                returnFromCoreVault = await this.updateReturnFromCoreVault(rootEm, returnFromCoreVault, {
                    state: ReturnFromCoreVaultState.STARTED,
                    proofRequestRound: undefined,
                    proofRequestData: undefined,
                });
            }
        }
    }

    async updateReturnFromCoreVault(rootEm: EM, uid: { id: number }, modifications: Partial<ReturnFromCoreVault>): Promise<ReturnFromCoreVault> {
        return await this.bot.runInTransaction(rootEm, async (em) => {
            const underlyingPayment = await em.findOneOrFail(ReturnFromCoreVault, { id: uid.id }, { refresh: true });
            Object.assign(underlyingPayment, modifications);
            return underlyingPayment;
        });
    }

    async getLatestOpenReturnFromCoreVault(rootEm: EM, vaultAddress: string): Promise<ReturnFromCoreVault | null>{
        const latestReturnFromCoreVault = await rootEm.findOne(ReturnFromCoreVault,
            {
              state: { $ne: ReturnFromCoreVaultState.DONE },
              agentAddress: vaultAddress
            },
            { orderBy: { createdAt: 'DESC' } }
          );
        return latestReturnFromCoreVault;
    }

}
