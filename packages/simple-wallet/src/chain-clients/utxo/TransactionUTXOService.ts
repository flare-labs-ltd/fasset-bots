import {
    createTransactionInputEntity,
    findTransactionsWithStatuses,
    transactional,
    transformUTXOToTxInputEntity
} from "../../db/dbutils";
import BN from "bn.js";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import {
    ChainType,
    MEMPOOL_CHAIN_LENGTH_LIMIT,
    UNKNOWN_DESTINATION,
    UNKNOWN_SOURCE,
} from "../../utils/constants";
import { logger } from "../../utils/logger";
import { EntityManager, Loaded, RequiredEntityData } from "@mikro-orm/core";
import { toBN } from "../../utils/bnutils";
import { TransactionInputEntity } from "../../entity/transactionInput";
import {
    getDustAmount,
    getMinimumUsefulUTXOValue,
    isEnoughUTXOs,
    rearrangeUTXOs
} from "./UTXOUtils";
import {
    MempoolUTXO,
    UTXORawTransaction,
    UTXORawTransactionInput
} from "../../interfaces/IBlockchainAPI";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";
import { IUtxoWalletServices } from "./IUtxoWalletServices";
import { TransactionData } from "../../interfaces/IWalletTransaction";


export class TransactionUTXOService {
    private readonly chainType: ChainType;
    private readonly enoughConfirmations: number;

    private readonly rootEm: EntityManager;
    private readonly blockchainAPI: UTXOBlockchainAPI;

    // <address, Map<hash:vout, script>>
    private utxoScriptMap: Map<string, Map<string, string>>;
    private timestampTracker: number;

    constructor(services: IUtxoWalletServices, chainType: ChainType, enoughConfirmations: number) {
        this.chainType = chainType;
        this.enoughConfirmations = enoughConfirmations;

        this.rootEm = services.rootEm;
        this.blockchainAPI = services.blockchainAPI;

        this.utxoScriptMap = new Map<string, Map<string, string>>();
        this.timestampTracker = Date.now();
    }

    getUtxoScriptMap() {
        return this.utxoScriptMap;
    }

    setTimestampTracker(timestamp: number) {
        this.timestampTracker = timestamp;
    }

    /**
     * Retrieves unspent transactions in format accepted by transaction
     * @param txData
     * @param source
     * @returns {UTXOEntity[]}
     */
    async fetchUTXOs(txData: TransactionData): Promise<MempoolUTXO[][] | null> {
        await this.removeOldUTXOScripts();

        logger.info(`Listing UTXOs for address ${JSON.stringify(txData)} and transaction ${txData.txId}`);
        const unspentUTXOs = await this.sortedMempoolUTXOs(txData.source);
        const needed = await this.selectUTXOs(unspentUTXOs, txData);
        if (needed) {
            return needed;
        }
        return null;
    }

    /**
     * Retrieves utxos to use in rbf transactions in format accepted by transaction
     * @param source
     * @param rbfedRawTx
     * @returns {UTXOEntity[]}
     */
    async getRbfUTXOs(source: string, rbfedRawTx: string): Promise<MempoolUTXO[]> {
        const rbfedRaw = JSON.parse(rbfedRawTx) as UTXORawTransaction;
        const rbfedInputs = [];
        for (const input of rbfedRaw.inputs) {
            const tx = await this.blockchainAPI.getTransaction(input.prevTxId);
            if (tx.vout[input.outputIndex].addresses.includes(source)) {
                rbfedInputs.push(input);
            }
        }
        return await this.createUTXOMempoolFromInputs(source, rbfedInputs);
    }

    private async selectUTXOs(allUTXOs: MempoolUTXO[], txData: TransactionData): Promise<MempoolUTXO[][] | null> {
        // filter out dust inputs
        const validUTXOs = allUTXOs.filter((utxo) => utxo.value.gte(getDustAmount(this.chainType)));

        if (!isEnoughUTXOs(allUTXOs, txData)) {
            return null;
        }

        let validChoices: MempoolUTXO[][] = [];
        const confirmedUTXOs = validUTXOs.filter((utxo) => utxo.confirmed);
        const onlyConfirmed = await this.gatherUTXOS(confirmedUTXOs, txData);
        if (onlyConfirmed) {
            validChoices = [...onlyConfirmed];
        }
        const confirmedAndMempool = await this.gatherUTXOS(validUTXOs, txData);
        if (confirmedAndMempool) {
            validChoices = [...confirmedAndMempool];
        }
        if (validChoices.length > 0) {
            return validChoices;
        } else {
            return null;
        }
    }

    private async gatherUTXOS(utxos: MempoolUTXO[], txData: TransactionData): Promise<MempoolUTXO[][]> {
        const desiredChangeValue: BN = txData.desiredChangeValue;
        const amountToCover: BN = txData.amount.add(txData.fee ?? toBN(0));

        let bestUtxoWithChange: MempoolUTXO[] = []; // smallest utxo where amountToSent + change >= utxo.value
        let bestUtxoWithoutChange: MempoolUTXO[] = []; // smallest utxo where amountToSent >= utxo.value
        let bestUtxoWithAdditionalToCreateChange: MempoolUTXO[] = []; // smallest utxo where amountToSent >= utxo.value
        const smallUtxosWithChange: MempoolUTXO[] = []; // multiple utxos, where utxo.value <= amountToSent and sum(utxo.value) + change >= utxo.value
        const smallUtxosWithAlmostChange: MempoolUTXO[] = []; // multiple utxos, where utxo.value <= amountToSent and sum(utxo.value) + change >= utxo.value
        const smallUtxosWithoutChange: MempoolUTXO[] = []; // multiple utxos, where utxo.value <= amountToSent and sum(utxo.value) >= utxo.value

        let totalSmallWithChange = toBN(0);
        let totalSmallWithAlmostChange = toBN(0);
        let totalSmallWithoutChange = toBN(0);

        const amountToSendWithChange = amountToCover.add(desiredChangeValue);
        const amountToSendWithoutChange = amountToCover.add(getMinimumUsefulUTXOValue(this.chainType));

        for (const utxo of utxos) {
            console.log(utxo.transactionHash, utxo.position, utxo.value.toString())
            if (utxo.value.gte(amountToSendWithChange)) { // find smallest where amountToSent + change >= utxo.value
                bestUtxoWithChange = [utxo];
            }
            if (utxo.value.gte(amountToSendWithoutChange) && utxo.value.lt(amountToSendWithChange) && (bestUtxoWithoutChange.length === 0 || bestUtxoWithoutChange[0].value.lt(utxo.value))) { // find smallest where amountToSent >= utxo.value && amountToSent < amountToSendWithChange
                console.log("----!!!!!!!----", utxo.value.toString())
                    bestUtxoWithoutChange = [utxo];
            }
            if (utxo.value.lte(amountToCover)) { // using utxo <= amount
                if (totalSmallWithChange.lt(amountToSendWithChange)) { // with lot change
                    totalSmallWithChange = totalSmallWithChange.add(utxo.value);
                    smallUtxosWithChange.push(utxo);
                }
                if (totalSmallWithoutChange.lt(amountToSendWithoutChange) && totalSmallWithoutChange.add(utxo.value).lt(amountToSendWithChange)) { // no lot change
                    totalSmallWithoutChange = totalSmallWithoutChange.add(utxo.value);
                    smallUtxosWithoutChange.push(utxo);
                }
                if ((totalSmallWithAlmostChange.lt(amountToSendWithoutChange) && totalSmallWithAlmostChange.add(utxo.value).lt(amountToSendWithChange)) ||
                    (totalSmallWithAlmostChange.add(utxo.value).gte(amountToSendWithoutChange) && totalSmallWithAlmostChange.add(utxo.value).lt(amountToSendWithChange))) { // almost lot change
                    totalSmallWithAlmostChange = totalSmallWithAlmostChange.add(utxo.value);
                    smallUtxosWithAlmostChange.push(utxo);
                }
            }
            if (bestUtxoWithoutChange.length === 1 &&
                (bestUtxoWithoutChange[0].transactionHash != utxo.transactionHash || bestUtxoWithoutChange[0].transactionHash == utxo.transactionHash && bestUtxoWithoutChange[0].position != utxo.position) &&
                bestUtxoWithoutChange[0].value.add(utxo.value).gte(amountToSendWithChange)) {
                bestUtxoWithAdditionalToCreateChange = [bestUtxoWithoutChange[0], utxo];
            }
        }

        const residualAmount = smallUtxosWithChange.reduce((sum, utxo) => sum.add(utxo.value), toBN(0)).sub(amountToCover);
        const rearrangeUTXOsWithChangeBySmallestDiff = rearrangeUTXOs([bestUtxoWithChange, residualAmount.gte(desiredChangeValue) ? smallUtxosWithChange : [], bestUtxoWithAdditionalToCreateChange], true, amountToCover);
        const rearrangeUTXOsNoChangeByHighestDiff = rearrangeUTXOs([bestUtxoWithoutChange, smallUtxosWithoutChange, smallUtxosWithAlmostChange], false, amountToCover);
        const validChoices: MempoolUTXO[][] = [...rearrangeUTXOsWithChangeBySmallestDiff, ...rearrangeUTXOsNoChangeByHighestDiff];

        return validChoices;
    }

    public async getNumberOfMempoolAncestors(txHash: string): Promise<number> {
        const ancestors = await this.getMempoolAncestors(txHash);
        const numOfAncestors = ancestors.filter((t) => t.transactionHash !== txHash).length;
        if (numOfAncestors > 0) {
            logger.info(`Transaction with hash ${txHash} has ${numOfAncestors} mempool ancestors`);
        }
        return numOfAncestors;
    }

    private async getMempoolAncestors(txHash: string): Promise<Loaded<TransactionEntity, "inputs" | "outputs">[]> {
        const txEnt = await this.getTransactionEntityByHash(txHash);
        if (
            !txEnt ||
            txEnt.status === TransactionStatus.TX_SUCCESS ||
            txEnt.status === TransactionStatus.TX_FAILED ||
            txEnt.status === TransactionStatus.TX_SUBMISSION_FAILED
        ) {
            return [];
        } else {
            let ancestors = [txEnt];
            for (const input of txEnt.inputs.getItems().filter((t) => t.transactionHash !== txHash)) {
                // this filter is here because of a weird orm bug
                const res = await this.getMempoolAncestors(input.transactionHash);
                ancestors = [...ancestors, ...res];
                if (ancestors.length >= MEMPOOL_CHAIN_LENGTH_LIMIT) {
                    return ancestors;
                }
            }
            return ancestors;
        }
    }

    private async getTransactionEntityByHash(txHash: string) {
        let txEnt = await this.rootEm.findOne(TransactionEntity, {
            transactionHash: txHash,
            chainType: this.chainType
        }, {populate: ["inputs"]});
        if (!txEnt) {
            logger.info(`Transaction with hash ${txHash} not in db, fetching it from API`);
            const tr = await this.blockchainAPI.getTransaction(txHash);
            /* istanbul ignore else */
            if (tr) {
                logger.info(`Transaction with hash ${txHash} fetched from API will be saved to DB`);
                await transactional(this.rootEm, async (em) => {
                    /* istanbul ignore next */
                    const txEnt = em.create(TransactionEntity, {
                        chainType: this.chainType,
                        source: tr.vin[0]?.addresses?.[0] ?? UNKNOWN_SOURCE,
                        destination: UNKNOWN_DESTINATION,
                        transactionHash: txHash,
                        fee: toBN(tr.fees ?? 0),
                        status: tr.blockHash && tr.confirmations >= this.enoughConfirmations ? TransactionStatus.TX_SUCCESS : TransactionStatus.TX_SUBMITTED,
                        numberOfOutputs: tr.vout.length ?? 0
                    } as RequiredEntityData<TransactionEntity>);

                    const inputs: TransactionInputEntity[] = [];
                    for (const t of tr.vin) {
                        if (t.txid && t.value && t.vout) {
                            inputs.push(createTransactionInputEntity(em, txEnt, t.txid, t.value, t.vout, ""));
                        }
                    }
                    txEnt.inputs.add(inputs);

                    em.persist(txEnt);
                });
            }

            txEnt = await this.rootEm.findOne(TransactionEntity, {
                transactionHash: txHash,
                chainType: this.chainType
            }, {populate: ["inputs"]});
        }

        return txEnt;
    }

    async handleMissingUTXOScripts(utxos: MempoolUTXO[], source: string): Promise<MempoolUTXO[]> {
        for (const utxo of utxos) {
            if (!utxo.script) {
                if (!this.utxoScriptMap.has(source)) {
                    this.utxoScriptMap.set(source, new Map<string, string>());
                }
                const addressScriptMap = this.utxoScriptMap.get(source) as Map<string, string>;
                if (!addressScriptMap.has(`${utxo.transactionHash}:${utxo.position}`)) {
                    const script = await this.blockchainAPI.getUTXOScript(utxo.transactionHash, utxo.position);
                    addressScriptMap.set(`${utxo.transactionHash}:${utxo.position}`, script);
                }
                utxo.script = addressScriptMap.get(`${utxo.transactionHash}:${utxo.position}`)!;
            }
        }
        return utxos;
    }

    async getUTXOToTransactionMap(dbUTXOs: MempoolUTXO[], txId: number) {
        const utxoToTxMap = new Map<string, TransactionEntity>();
        for (const utxo of dbUTXOs) {
            const tx = await this.getTransactionEntityByHash(utxo.transactionHash);
            /* istanbul ignore else */
            if (tx) {
                utxoToTxMap.set(`${utxo.transactionHash}:${utxo.position}`, tx);
            } else {
                logger.warn(`Transaction ${txId}: Transaction (utxo) with hash ${utxo.transactionHash} and ${utxo.position} could not be found on api`);
            }
        }

        return utxoToTxMap;
    }

    async createInputsFromUTXOs(em: EntityManager, dbUTXOs: MempoolUTXO[], utxoToTxMap: Map<string, TransactionEntity>) {
        const inputs: TransactionInputEntity[] = [];
        for (const utxo of dbUTXOs) {
            if (utxoToTxMap.has(`${utxo.transactionHash}:${utxo.position}`)) {
                inputs.push(transformUTXOToTxInputEntity(em, utxo, utxoToTxMap.get(`${utxo.transactionHash}:${utxo.position}`)!));
            }
        }
        return inputs;
    }

    private async findTransactionInputsBySourceAndStatuses(source: string): Promise<Set<string>> {
        const pendingTransactionEntities: TransactionEntity[] = await findTransactionsWithStatuses(this.rootEm, this.chainType, [TransactionStatus.TX_SUBMITTED, TransactionStatus.TX_PENDING, TransactionStatus.TX_REPLACED_PENDING], source);
        const pendingInputSet = new Set<string>();
        for (const txEnt of pendingTransactionEntities) {
            if (txEnt.raw) {
                const rawTx = JSON.parse(txEnt.raw) as UTXORawTransaction;
                for (const input of rawTx.inputs) {
                    pendingInputSet.add(`${input.prevTxId}:${input.outputIndex}`);
                }
            }
        }
        return pendingInputSet;
    }

    async sortedMempoolUTXOs(source: string): Promise<MempoolUTXO[]> {
        const mempoolUTXOs = await this.blockchainAPI.getUTXOsFromMempool(source);
        const pendingInputs = await this.findTransactionInputsBySourceAndStatuses(source);
        const filteredMempoolUTXOs = mempoolUTXOs.filter(
            utxo => !pendingInputs.has(`${utxo.transactionHash}:${utxo.position}`)
        );
        // sort by value (descending)
        const sortedMempoolUTXOs = filteredMempoolUTXOs.sort((a, b) => {
            const aValue = (a.value);
            const bValue = (b.value);
            return Number(bValue.sub(aValue));
        });
        return sortedMempoolUTXOs;
    }

    private async createUTXOMempoolFromInputs(source: string, inputs: UTXORawTransactionInput[]): Promise<MempoolUTXO[]> {
        const mempoolRbfUTXOs: MempoolUTXO[] = [];
        for (const input of inputs) {
            const mempoolRbfUTXO: MempoolUTXO = {
                transactionHash: input.prevTxId,
                position: input.outputIndex,
                value: toBN(input.output.satoshis),
                confirmed: false,
                script: "",
            };
            mempoolRbfUTXOs.push(mempoolRbfUTXO);
        }
        const res = await this.handleMissingUTXOScripts(mempoolRbfUTXOs, source);
        return res;
    }

    async removeOldUTXOScripts() {
        const currentTime = Date.now();
        if (currentTime < this.timestampTracker + 24 * 60 * 60 * 1000) {
            return;
        }

        const addresses = this.utxoScriptMap.keys();
        for (const address of addresses) {
            await this.removeOldUTXOScriptsForAddress(address);
        }

        this.timestampTracker = Date.now();
    }

    private async removeOldUTXOScriptsForAddress(source: string) {
        logger.info(`Removing UTXO scripts used by transactions that were accepted to blockchain for address ${source}`);
        const lowerTimeBound = this.timestampTracker - 24 * 60 * 60 * 1000;
        const transactions = await this.rootEm.find(TransactionEntity, {
            status: TransactionStatus.TX_SUCCESS,
            reachedFinalStatusInTimestamp: {
                $gte: toBN(lowerTimeBound), $lte: toBN(this.timestampTracker)
            },
            source: source,
            chainType: this.chainType
        });

        const addressScriptMap = this.utxoScriptMap.get(source);
        if (!addressScriptMap) {
            return;
        }

        const startSize = Array.from(addressScriptMap.keys()).length;
        for (const txEnt of transactions) {
            const tr = JSON.parse(txEnt.raw!) as UTXORawTransaction;
            for (const t of tr.inputs) {
                addressScriptMap.delete(`${t.prevTxId}:${t.outputIndex}`);
            }
        }
        const endSize = Array.from(addressScriptMap.keys()).length;
        logger.info(`Removed ${startSize - endSize} UTXO scripts used by transactions that were accepted to blockchain for address ${source}; it currently has ${endSize} scripts stored`);
    }
}
