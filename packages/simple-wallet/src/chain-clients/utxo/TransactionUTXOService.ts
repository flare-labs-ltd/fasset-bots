import { IService } from "../../interfaces/IService";
import {
    createTransactionInputEntity,
    fetchTransactionEntityById,
    fetchUnspentUTXOs,
    fetchUTXOsByTxId,
    storeUTXOS, transformUTXOEntToTxInputEntity, updateTransactionEntity,
    updateUTXOEntity,
} from "../../db/dbutils";
import { UTXO } from "../../interfaces/IWalletTransaction";
import BN, { max } from "bn.js";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { SpentHeightEnum, UTXOEntity } from "../../entity/utxo";
import { TransactionOutputEntity } from "../../entity/transactionOutput";
import { ServiceRepository } from "../../ServiceRepository";
import { BlockchainAPIWrapper } from "../../blockchain-apis/BlockchainAPIWrapper";
import { ChainType, DEFAULT_FEE_INCREASE } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { EntityManager, RequiredEntityData } from "@mikro-orm/core";
import { TransactionFeeService } from "./TransactionFeeService";
import { toBN } from "../../utils/bnutils";
import { TransactionInputEntity } from "../../entity/transactionInput";

export class TransactionUTXOService implements IService {

    private readonly chainType: ChainType;
    private readonly enoughConfirmations: number;
    private readonly mempoolChainLengthLimit: number;

    private readonly rootEm: EntityManager;

    constructor(chainType: ChainType, mempoolChainLengthLimit: number, enoughConfirmations: number) {
        this.chainType = chainType;
        this.enoughConfirmations = enoughConfirmations;
        this.mempoolChainLengthLimit = mempoolChainLengthLimit;

        this.rootEm = ServiceRepository.get(this.chainType, EntityManager);
    }

    /**
     * Retrieves unspent transactions in format accepted by transaction
     * @param {string} address
     * @param {BN|null} amountInSatoshi - if null => empty all funds
     * @param feeInSatoshi
     * @param {number} estimatedNumOfOutputs
     * @param txForReplacement
     * @returns {Object[]}
     */
    async fetchUTXOs(address: string, amountInSatoshi: BN | null, feeInSatoshi: BN | undefined, estimatedNumOfOutputs: number, txForReplacement?: TransactionEntity): Promise<[UTXO[], UTXOEntity[]]> {
        const dbUTXOs = await this.listUnspent(address, amountInSatoshi, feeInSatoshi, estimatedNumOfOutputs, txForReplacement);
        const allUTXOs: UTXO[] = [];

        for (const utxo of dbUTXOs) {
            if (!utxo.script) {
                const txOutputEnt = await this.rootEm.findOne(TransactionOutputEntity, {
                    vout: utxo.vout,
                    transactionHash: utxo.txid,
                });
                utxo.script = txOutputEnt?.script ? txOutputEnt.script : await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getUTXOScript(address, utxo.mintTransactionHash, utxo.position, this.chainType);
                await updateUTXOEntity(this.rootEm, utxo.mintTransactionHash, utxo.position, utxoEnt => utxoEnt.script = utxo.script);
            }
            const item = {
                txid: utxo.mintTransactionHash,
                satoshis: Number(utxo.value),
                outputIndex: utxo.position,
                confirmations: -1,
                scriptPubKey: utxo.script,
            };
            allUTXOs.push(item);
        }
        return [allUTXOs, dbUTXOs];
    }

    /**
     * Retrieves unspent transactions
     * @param {string} address
     * @param {BN|null} amountInSatoshi - if null => empty all funds
     * @param feeInSatoshi
     * @param {number} estimatedNumOfOutputs
     * @param txForReplacement
     * @returns {Object[]}
     */
    private async listUnspent(address: string, amountInSatoshi: BN | null, feeInSatoshi: BN | undefined, estimatedNumOfOutputs: number, txForReplacement?: TransactionEntity): Promise<any[]> {
        // fetch db utxos
        logger.info(`Listing UTXOs for address ${address}`);
        let dbUTXOS = await fetchUnspentUTXOs(this.rootEm, address, txForReplacement);
        // fill from mempool and refetch
        if (dbUTXOS.length == 0) {
            await this.fillUTXOsFromMempool(address);
            dbUTXOS = await fetchUnspentUTXOs(this.rootEm, address, txForReplacement);
        }
        if (amountInSatoshi == null) {
            return dbUTXOS;
        }
        const needed = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi, feeInSatoshi, txForReplacement);
        if (needed) {
            return needed;
        }
        // not enough funds in db
        await this.fillUTXOsFromMempool(address);
        dbUTXOS = await fetchUnspentUTXOs(this.rootEm, address, txForReplacement);
        const neededAfter = await this.returnNeededUTXOs(dbUTXOS, estimatedNumOfOutputs, amountInSatoshi, feeInSatoshi, txForReplacement);
        if (neededAfter) {
            return neededAfter;
        }
        return dbUTXOS;
    }

    private async returnNeededUTXOs(allUTXOS: UTXOEntity[], estimatedNumOfOutputs: number, amountInSatoshi: BN, feeInSatoshi?: BN, txForReplacement?: TransactionEntity): Promise<UTXOEntity[] | null> {
        feeInSatoshi = feeInSatoshi ?? toBN(0);

        const neededUTXOs = txForReplacement?.utxos ? txForReplacement?.utxos.getItems() : [];
        let sum = neededUTXOs.reduce((acc, utxo) => acc.add(utxo.value), new BN(0));

        for (const utxo of allUTXOS) {
            const isAlreadyInNeeded = neededUTXOs.some(existingUTXO =>
                existingUTXO.mintTransactionHash === utxo.mintTransactionHash &&
                existingUTXO.position === utxo.position
            );
            const numAncestors = await this.getNumberOfAncestorsInMempool(utxo.mintTransactionHash);
            if (numAncestors >= this.mempoolChainLengthLimit) {
                logger.info(`Number of UTXO mempool ancestors ${numAncestors} is greater than limit of ${this.mempoolChainLengthLimit} for UTXO with hash ${utxo.mintTransactionHash}`);
                continue;
            }
            if (!isAlreadyInNeeded) {
                neededUTXOs.push(utxo);
            }
            sum = sum.add(utxo.value);
            const est_fee = await ServiceRepository.get(this.chainType, TransactionFeeService).getEstimateFee(neededUTXOs.length, estimatedNumOfOutputs);
            // multiply estimated fee by 1.4 to ensure enough funds TODO: is it enough?
            if (toBN(sum).gt(amountInSatoshi.add(max(est_fee, feeInSatoshi).muln(DEFAULT_FEE_INCREASE)))) {
                return neededUTXOs;
            }
        }
        return null;
    }

    async fillUTXOsFromMempool(address: string) {
        const utxos = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getUTXOsFromMempool(address, this.chainType);
        await storeUTXOS(this.rootEm, address, utxos);
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

    private async getTransactionEntityByHash(txHash: string) {

        let txEnt = await this.rootEm.findOne(TransactionEntity, { transactionHash: txHash }, { populate: ["inputs", "outputs"] });
        if (txEnt && (txEnt.status != TransactionStatus.TX_SUBMISSION_FAILED || txEnt.status != TransactionStatus.TX_SUBMISSION_FAILED)) {
            const tr = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getTransaction(txHash);
            if (tr && tr.data.blockHash && tr.data.confirmations >= this.enoughConfirmations) {
                txEnt.status = TransactionStatus.TX_SUCCESS;
                await this.rootEm.persistAndFlush(txEnt);
            }
        }
        if (!txEnt) {
            const tr = await ServiceRepository.get(this.chainType, BlockchainAPIWrapper).getTransaction(txHash);
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

    private async getNumberOfAncestorsInMempool(txHash: string): Promise<number> {
        const txEnt = await this.getTransactionEntityByHash(txHash);
        if (!txEnt || txEnt.status === TransactionStatus.TX_SUCCESS || txEnt.status === TransactionStatus.TX_FAILED || txEnt.status === TransactionStatus.TX_SUBMISSION_FAILED) {
            return 0;
        } else {
            let numAncestorsInMempool = 0;
            for (const input of txEnt!.inputs.getItems().filter(t => t.transactionHash !== txHash)) { // this filter is here because of a weird orm bug
                numAncestorsInMempool += 1 + await this.getNumberOfAncestorsInMempool(input.transactionHash);
                if (numAncestorsInMempool >= 25) {
                    return 25;
                }
            }
            return numAncestorsInMempool;
        }
    }
}