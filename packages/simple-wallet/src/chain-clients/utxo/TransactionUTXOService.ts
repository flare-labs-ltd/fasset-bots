import { IService } from "../../interfaces/IService";
import {
    createTransactionInputEntity,
    fetchTransactionEntityById,
    fetchUnspentUTXOs,
    fetchUTXOsByTxId,
    transformUTXOEntToTxInputEntity,
    updateTransactionEntity,
    updateUTXOEntity,
} from "../../db/dbutils";
import BN from "bn.js";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { SpentHeightEnum, UTXOEntity } from "../../entity/utxo";
import { TransactionOutputEntity } from "../../entity/transactionOutput";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainAPIWrapper } from "../../blockchain-apis/UTXOBlockchainAPIWrapper";
import { ChainType } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { EntityManager, Loaded, RequiredEntityData } from "@mikro-orm/core";
import { FeeStatus, TransactionFeeService } from "./TransactionFeeService";
import { toBN, toBNExp } from "../../utils/bnutils";
import { TransactionInputEntity } from "../../entity/transactionInput";
import { MempoolUTXO } from "../../interfaces/IBlockchainAPI";
import { TransactionService } from "./TransactionService";
import { isEnoughUTXOs } from "./UTXOUtils";

export interface TransactionData {
    source: string,
    destination: string,
    amount: BN,
    fee?: BN,
    feePerKB?: BN,
    useChange: boolean,
    note?: string
}

export class TransactionUTXOService implements IService {
    private readonly chainType: ChainType;
    private readonly enoughConfirmations: number;
    private readonly mempoolChainLengthLimit: number;

    readonly maximumNumberOfUTXOs: number;
    readonly minimumUTXOValue: BN;

    private readonly rootEm: EntityManager;
    private readonly blockchainAPI: BlockchainAPIWrapper;

    constructor(chainType: ChainType, mempoolChainLengthLimit: number, enoughConfirmations: number) {
        this.chainType = chainType;
        this.enoughConfirmations = enoughConfirmations;
        this.mempoolChainLengthLimit = mempoolChainLengthLimit;

        this.maximumNumberOfUTXOs = 5;

        if (this.chainType === ChainType.testDOGE || this.chainType === ChainType.DOGE) {
            this.minimumUTXOValue = toBNExp(1, 7);
        } else if (this.chainType === ChainType.testBTC || this.chainType === ChainType.BTC) {
            this.minimumUTXOValue = toBNExp(1, 5);
        } else {
            this.minimumUTXOValue = toBNExp(1, 5);
        }

        this.rootEm = ServiceRepository.get(this.chainType, EntityManager);
        this.blockchainAPI = ServiceRepository.get(this.chainType, BlockchainAPIWrapper);
    }

    /**
     * Retrieves unspent transactions in format accepted by transaction
     * @param txData
     * @param txForReplacement
     * @returns {UTXOEntity[]}
     */
    async fetchUTXOs(txData: TransactionData, txForReplacement?: TransactionEntity): Promise<UTXOEntity[]> {
        const dbUTXOs = await this.listUnspent(txData, txForReplacement);
        return this.handleMissingUTXOScripts(dbUTXOs);
    }

    /**
     * Retrieves unspent transactions
     * @param txData
     * @param txForReplacement
     * @returns {Object[]}
     */
    private async listUnspent(txData: TransactionData, txForReplacement?: TransactionEntity): Promise<UTXOEntity[]> {
        logger.info(`Listing UTXOs for address ${txData.source}`);
        const currentFeeStatus = await ServiceRepository.get(this.chainType, TransactionFeeService).getCurrentFeeStatus();
        let fetchUnspent = await fetchUnspentUTXOs(this.rootEm, txData.source, txForReplacement);
        let dbUTXOS = await this.handleMissingUTXOScripts(fetchUnspent);
        const needed = await this.selectUTXOs(dbUTXOS, txForReplacement, txData, false, currentFeeStatus);
        if (needed) {
            return needed;
        }
        return [];
    }

    // allUTXOs = currently available UTXOs (either from db or db + fetch from mempool)
    private async selectUTXOs(allUTXOs: UTXOEntity[], txForReplacement: TransactionEntity | undefined, txData: TransactionData, fetchedMempool: boolean = false, feeStatus: FeeStatus) {
        const rbfUTXOs = txForReplacement?.utxos ? txForReplacement?.utxos.getItems() : [];

        if (!isEnoughUTXOs(rbfUTXOs.concat(allUTXOs), txData.amount, txData.fee)) {
            return null; //try to refetch new UTXOs from mempool
        }

        const notMinimalUTXOs = allUTXOs.filter(utxo => utxo.value.gte(this.minimumUTXOValue));
        let utxos: UTXOEntity[] = notMinimalUTXOs;

        let usingMinimalUTXOs = false; // If we're using the UTXOs which are < this.minimumUTXOValue
        if (!isEnoughUTXOs(rbfUTXOs.concat(notMinimalUTXOs), txData.amount, txData.fee)) {
            if (fetchedMempool) {
                utxos = allUTXOs;
                usingMinimalUTXOs = true;
            } else {
                // refetch from mempool
                return null;
            }
        } else {
            utxos = notMinimalUTXOs;
        }

        let res: UTXOEntity[] | null = null;
        if (feeStatus == FeeStatus.HIGH) {
            // order by value, confirmed
            utxos.sort((a, b) => a.confirmed == b.confirmed ? b.value.sub(a.value).toNumber() : Number(b.confirmed) - Number(a.confirmed));
            res = await this.collectUTXOs(utxos, rbfUTXOs, txData);
        } else if (feeStatus == FeeStatus.MEDIUM || feeStatus == FeeStatus.LOW) {
            // check if we can build tx with utxos with utxo.value < amountToSend
            const smallUTXOs = utxos.filter(utxo => utxo.value.lte(txData.amount));
            if (isEnoughUTXOs(smallUTXOs, txData.amount, txData.fee)) {
                res = await this.collectUTXOs(smallUTXOs, rbfUTXOs, txData);
            }
            if (!res) {
                res = await this.collectUTXOs(utxos, rbfUTXOs, txData);
            }
        }

        if (res && !usingMinimalUTXOs && feeStatus == FeeStatus.LOW && res.length < this.maximumNumberOfUTXOs) {
            const minimalUTXOs = allUTXOs.filter(utxo => utxo.value.lt(this.minimumUTXOValue));
            for (let i = 0; i < this.maximumNumberOfUTXOs - res.length && i < minimalUTXOs.length; i++) {
                res.push(minimalUTXOs[i]);
            }
        }

        return res;
    }

    private async collectUTXOs(utxos: UTXOEntity[], rbfUTXOs: UTXOEntity[], txData: TransactionData) {
        const minimumUTXOValue: BN = this.minimumUTXOValue;
        const baseUTXOs: UTXOEntity[] = rbfUTXOs.slice(); // UTXOs needed for creating tx with >= 0 output
        const additionalUTXOs: UTXOEntity[] = rbfUTXOs.slice(); // UTXOs needed for creating tx with >= minimalUTXOSize output

        const rbfUTXOsValue = rbfUTXOs.length > 0 ? this.calculateTransactionValue(txData, baseUTXOs) : new BN(0);
        if (rbfUTXOsValue.gte(minimumUTXOValue)) {
            return baseUTXOs;
        }

        let positiveValueReached = rbfUTXOsValue.gten(0) && rbfUTXOs.length > 0;
        const utxoSet = new Set(utxos);

        while (utxoSet.size > 0) {
            for (const utxo of utxoSet) {
                const numAncestors = await this.getNumberOfMempoolAncestors(utxo.mintTransactionHash);
                if (numAncestors >= this.mempoolChainLengthLimit) {
                    logger.info(`Number of UTXO mempool ancestors ${numAncestors} is greater than limit of ${this.mempoolChainLengthLimit} for UTXO with hash ${utxo.mintTransactionHash}`);
                    utxoSet.delete(utxo);
                    continue; //skip this utxo
                }

                if (Math.random() > 0.5) {
                    if (!positiveValueReached) {
                        baseUTXOs.push(utxo);
                    }
                    additionalUTXOs.push(utxo);
                    utxoSet.delete(utxo);

                    if (!positiveValueReached && this.calculateTransactionValue(txData, baseUTXOs).gten(0)) {
                        positiveValueReached = true;
                    }

                    if (this.calculateTransactionValue(txData, additionalUTXOs).gte(minimumUTXOValue)) {
                        return additionalUTXOs;
                    }
                }
            }
        }

        return positiveValueReached ? baseUTXOs : null;
    }

    public async getNumberOfMempoolAncestors(txHash: string): Promise<number> {
        const ancestors = await this.getMempoolAncestors(txHash);
        return ancestors
            .filter(t => t.transactionHash !== txHash)
            .length;
    }

    private async getMempoolAncestors(txHash: string): Promise<Loaded<TransactionEntity, "inputs" | "outputs">[]> {
        const txEnt = await this.getTransactionEntityByHash(txHash);
        if (!txEnt || txEnt.status === TransactionStatus.TX_SUCCESS || txEnt.status === TransactionStatus.TX_FAILED || txEnt.status === TransactionStatus.TX_SUBMISSION_FAILED) {
            return [];
        } else {
            let ancestors = [txEnt];
            for (const input of txEnt!.inputs.getItems().filter(t => t.transactionHash !== txHash)) { // this filter is here because of a weird orm bug
                const res = await this.getMempoolAncestors(input.transactionHash);
                ancestors = [...ancestors, ...res];
                if (ancestors.length >= 25) {
                    return ancestors;
                }
            }
            return ancestors;
        }
    }

    private calculateTransactionValue(txData: TransactionData, utxos: UTXOEntity[]) {
        const transactionService = ServiceRepository.get(this.chainType, TransactionService);
        const tr = transactionService.createBitcoreTransaction(txData.source, txData.destination, txData.amount, txData.fee, txData.feePerKB, utxos, txData.useChange, txData.note);
        const val = utxos.reduce((acc, utxo) => acc.add(utxo.value), new BN(0)).sub(txData.amount);

        if (txData.fee) {
            return val.sub(txData.fee);
        } else if (tr.getFee() < 0) {
            return toBN(-10);
        } else {
            return val.sub(toBN(tr.getFee()));
        }
    }

    async checkIfTxUsesAlreadySpentUTXOs(txId: number) {
        const utxoEnts = await fetchUTXOsByTxId(this.rootEm, txId);
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        if (txEnt.rbfReplacementFor) {
            return false;
        }
        for (const utxo of utxoEnts) { // If there's an UTXO that's already been SENT/SPENT we should create tx again
            if (utxo.spentHeight !== SpentHeightEnum.UNSPENT) {
                logger.warn(`Transaction ${txId} tried to use already SENT/SPENT utxo with hash ${utxo.mintTransactionHash}`);
                await updateTransactionEntity(this.rootEm, txId, async (txEnt) => {
                    txEnt.status = TransactionStatus.TX_CREATED;
                    txEnt.utxos.removeAll();
                    txEnt.raw = "";
                    txEnt.transactionHash = "";
                });

                const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
                txEnt.inputs.map(input => this.rootEm.remove(input));
                txEnt.outputs.map(output => this.rootEm.remove(output));
                await this.rootEm.persistAndFlush(txEnt);

                return true;
            }
        }
        return false;
    }

    private async getTransactionEntityByHash(txHash: string) {

        let txEnt = await this.rootEm.findOne(TransactionEntity, { transactionHash: txHash }, { populate: ["inputs", "outputs"] });
        if (txEnt && (txEnt.status != TransactionStatus.TX_SUBMISSION_FAILED || txEnt.status != TransactionStatus.TX_SUBMISSION_FAILED)) {
            const tr = await this.blockchainAPI.getTransaction(txHash);
            if (tr && tr.data.blockHash && tr.data.confirmations >= this.enoughConfirmations) {
                txEnt.status = TransactionStatus.TX_SUCCESS;
                await this.rootEm.persistAndFlush(txEnt);
            }
        }
        if (!txEnt) {
            const tr = await this.blockchainAPI.getTransaction(txHash);
            logger.warn(`Tx with hash ${txHash} not in db, fetched from api`);
            if (tr) {
                await this.rootEm.transactional(async em => {
                    const txEnt = em.create(TransactionEntity, {
                        chainType: this.chainType,
                        source: tr.data.vin[0].addresses[0] ?? "FETCHED_VIA_API_UNKNOWN_SOURCE",
                        destination: "FETCHED_VIA_API_UNKNOWN_DESTINATION",
                        transactionHash: txHash,
                        fee: toBN(tr.data.fees ?? tr.data.fee),
                        status: tr.data.blockHash && tr.data.confirmations >= this.enoughConfirmations ? TransactionStatus.TX_SUCCESS : TransactionStatus.TX_SUBMITTED,
                    } as RequiredEntityData<TransactionEntity>);

                    const inputs =
                        tr.data.vin.map((t: any) => createTransactionInputEntity(txEnt!, t.txid, t.value, t.vout ?? 0, t.hex ?? ""));
                    txEnt.inputs.add(inputs);

                    await em.persistAndFlush(txEnt);
                    await em.persistAndFlush(inputs);
                });
            }

            txEnt = await this.rootEm.findOne(TransactionEntity, { transactionHash: txHash }, { populate: ["inputs", "outputs"] });
        }

        return txEnt;
    }

    private async handleMissingUTXOScripts(utxos: UTXOEntity[]) {
        for (const utxo of utxos) {
            if (!utxo.script) {
                const txOutputEnt = await this.rootEm.findOne(TransactionOutputEntity, {
                    vout: utxo.position,
                    transactionHash: utxo.mintTransactionHash,
                });
                utxo.script = txOutputEnt?.script ? txOutputEnt.script : await this.blockchainAPI.getUTXOScript(utxo.mintTransactionHash, utxo.position);
                await updateUTXOEntity(this.rootEm, utxo.mintTransactionHash, utxo.position, async utxoEnt => {utxoEnt.script = utxo.script});
            }
        }
        return utxos;
    }

    async createInputsFromUTXOs(dbUTXOs: UTXOEntity[], txId: number) {
        const inputs: TransactionInputEntity[] = [];
        for (const utxo of dbUTXOs) {
            const tx = await this.getTransactionEntityByHash(utxo.mintTransactionHash);
            if (tx) {
                inputs.push(transformUTXOEntToTxInputEntity(utxo, tx));
            } else {
                logger.warn(`Transaction ${txId}: Transaction (utxo) with hash ${utxo.mintTransactionHash} could not be found on api`);
            }
        }
        await this.rootEm.persistAndFlush(inputs);
        return inputs;
    }

    async updateTransactionInputSpentStatus(txId: number, status: SpentHeightEnum) {
        const txEnt = await fetchTransactionEntityById(this.rootEm, txId);
        const transaction = JSON.parse(txEnt.raw!);
        for (const input of transaction.inputs) {
            await updateUTXOEntity(this.rootEm, input.prevTxId.toString("hex"), input.outputIndex, async (utxoEnt) => {
                utxoEnt.spentHeight = status;
            });
        }
    }
}