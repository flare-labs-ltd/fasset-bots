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
import { toBN, toNumber } from "../../utils/bnutils";
import { TransactionInputEntity } from "../../entity/transactionInput";
import {
    getCore,
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
import { TransactionData, UTXO } from "../../interfaces/IWalletTransaction";
import { unPrefix0x } from "../../utils/utils";
import { Transaction } from "bitcore-lib";
import UnspentOutput = Transaction.UnspentOutput;

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
        // confirmed utxos
        const confirmedUTXOs = validUTXOs.filter((utxo) => utxo.confirmed);
        const onlyConfirmed = await this.gatherUTXOS(confirmedUTXOs, txData);
        if (onlyConfirmed) {
            validChoices = [...onlyConfirmed];
        }
         // confirmed and mempool utxos
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
        const utxosJustToCoverAmountAndFee: MempoolUTXO[] = [];

        let totalSmallWithChange = toBN(0);
        let totalSmallWithAlmostChange = toBN(0);
        let totalSmallWithoutChange = toBN(0);
        let totalJustToCoverAmountAndFee = toBN(0);

        const amountToSendWithChange = amountToCover.add(desiredChangeValue); // amount to send with desired change
        const amountToSendWithoutChange = amountToCover.add(getMinimumUsefulUTXOValue(this.chainType)); // amount to send without desired change

        let amountBestUtxo = amountToSendWithChange;
        let amountBestUtxoWithoutChange = amountToSendWithoutChange;
        let amountBestUtxoWithAdditionalToCreateChange = amountToSendWithChange;
        let amountSmallUtxosWithChange = amountToSendWithChange;
        let amountSmallUtxosWithAlmostChange = amountToSendWithoutChange;
        let amountSmallUtxosWithoutChange = amountToSendWithoutChange;
        let amountToSendJustToCover = amountToCover;

        const validUTXOsWithChange: MempoolUTXO[][] = [];
        const validUTXOsWithoutChange: MempoolUTXO[][] = [];

        for (const utxo of utxos) {
            const numAncestors = await this.getNumberOfMempoolAncestors(utxo.transactionHash);
            if (numAncestors + 1 >= MEMPOOL_CHAIN_LENGTH_LIMIT) {
                logger.info(
                    `Number of UTXO mempool ancestors ${numAncestors} is >= than limit of ${MEMPOOL_CHAIN_LENGTH_LIMIT} for UTXO with hash ${utxo.transactionHash} and position ${utxo.position}`
                );
                continue; //skip this utxo
            }
            if (utxo.value.gte(amountBestUtxo)) { // find smallest where amountToSent + change >= utxo.value
                bestUtxoWithChange = [utxo];
                const toAdd = await this.checkIfItCoversFee(txData, bestUtxoWithChange, utxo.value);
                if (toAdd) {
                    amountBestUtxo = amountBestUtxo.add(toAdd);
                    bestUtxoWithChange = [];
                }
            }
            if (utxo.value.gte(amountBestUtxoWithoutChange) && utxo.value.lt(amountToSendWithChange) && (bestUtxoWithoutChange.length === 0 || bestUtxoWithoutChange[0].value.lt(utxo.value))) { // find smallest where amountToSent >= utxo.value && amountToSent < amountToSendWithChange
                    bestUtxoWithoutChange = [utxo];
                    const toAdd = await this.checkIfItCoversFee(txData, bestUtxoWithoutChange, utxo.value);
                    if (toAdd) {
                        amountBestUtxoWithoutChange = amountBestUtxoWithoutChange.add(toAdd);
                        bestUtxoWithoutChange = [];
                    }
            }
            if (utxo.value.lte(amountToCover)) { // using utxo <= amount
                if (totalSmallWithChange.lt(amountSmallUtxosWithChange)) { // with lot change
                    totalSmallWithChange = totalSmallWithChange.add(utxo.value);
                    smallUtxosWithChange.push(utxo);
                    const toAdd = await this.checkIfItCoversFee(txData, smallUtxosWithChange, totalSmallWithChange);
                    if (toAdd) {
                        amountSmallUtxosWithChange = amountSmallUtxosWithChange.add(toAdd);
                    }
                }
                if (totalSmallWithoutChange.lt(amountSmallUtxosWithoutChange) && totalSmallWithoutChange.add(utxo.value).lt(amountToSendWithChange)) { // no lot change
                    totalSmallWithoutChange = totalSmallWithoutChange.add(utxo.value);
                    smallUtxosWithoutChange.push(utxo);
                    const toAdd = await this.checkIfItCoversFee(txData, smallUtxosWithoutChange, totalSmallWithoutChange);
                    if (toAdd) {
                        amountSmallUtxosWithoutChange = amountSmallUtxosWithoutChange.add(toAdd);
                    }
                }
                if ((totalSmallWithAlmostChange.lt(amountSmallUtxosWithAlmostChange) && totalSmallWithAlmostChange.add(utxo.value).lt(amountToSendWithChange)) ||
                    (totalSmallWithAlmostChange.add(utxo.value).gte(amountSmallUtxosWithAlmostChange) && totalSmallWithAlmostChange.add(utxo.value).lt(amountToSendWithChange))) { // almost lot change
                    totalSmallWithAlmostChange = totalSmallWithAlmostChange.add(utxo.value);
                    smallUtxosWithAlmostChange.push(utxo);
                    const toAdd = await this.checkIfItCoversFee(txData, smallUtxosWithAlmostChange, totalSmallWithAlmostChange);
                    if (toAdd) {
                        amountSmallUtxosWithAlmostChange = amountSmallUtxosWithAlmostChange.add(toAdd);
                    }
                }
            }
            if (bestUtxoWithoutChange.length === 1 &&
                (bestUtxoWithoutChange[0].transactionHash != utxo.transactionHash || bestUtxoWithoutChange[0].transactionHash == utxo.transactionHash && bestUtxoWithoutChange[0].position != utxo.position) && // do not use the same utxo
                bestUtxoWithoutChange[0].value.add(utxo.value).gte(amountBestUtxoWithAdditionalToCreateChange)) {
                bestUtxoWithAdditionalToCreateChange = [bestUtxoWithoutChange[0], utxo];
                const toAdd = await this.checkIfItCoversFee(txData, bestUtxoWithAdditionalToCreateChange, bestUtxoWithoutChange[0].value.add(utxo.value));
                if (toAdd) {
                    amountBestUtxoWithAdditionalToCreateChange = amountBestUtxoWithAdditionalToCreateChange.add(toAdd);
                    bestUtxoWithAdditionalToCreateChange = [];
                }
            }
            if (totalJustToCoverAmountAndFee.lt(amountToSendJustToCover)) {
                totalJustToCoverAmountAndFee = totalJustToCoverAmountAndFee.add(utxo.value);
                utxosJustToCoverAmountAndFee.push(utxo);
                const toAdd = await this.checkIfItCoversFee(txData, utxosJustToCoverAmountAndFee, totalJustToCoverAmountAndFee);
                if (toAdd) {
                    amountToSendJustToCover = amountToSendJustToCover.add(toAdd);
                }
            }
        }
        if (bestUtxoWithChange.length > 0) {
            validUTXOsWithChange.push(bestUtxoWithChange);
        }
        if (bestUtxoWithoutChange.length > 0) {
            validUTXOsWithoutChange.push(bestUtxoWithoutChange);
        }
        if (bestUtxoWithAdditionalToCreateChange.length > 0) {
            validUTXOsWithChange.push(bestUtxoWithAdditionalToCreateChange);
        }
        if (smallUtxosWithChange.length > 0 && totalSmallWithChange.gte(amountSmallUtxosWithChange)) {
            validUTXOsWithChange.push(smallUtxosWithChange);
        }
        if (smallUtxosWithAlmostChange.length > 0 && totalSmallWithAlmostChange.gte(amountSmallUtxosWithAlmostChange)) {
            validUTXOsWithoutChange.push(smallUtxosWithAlmostChange);
        }
        if (smallUtxosWithoutChange.length > 0 && totalSmallWithoutChange.gte(amountSmallUtxosWithoutChange)) {
            validUTXOsWithoutChange.push(smallUtxosWithoutChange);
        }

        const rearrangeUTXOsWithChangeBySmallestDiff = rearrangeUTXOs(validUTXOsWithChange, true, amountToCover);
        const rearrangeUTXOsNoChangeByHighestDiff = rearrangeUTXOs(validUTXOsWithoutChange, false, amountToCover);
        const validChoices: MempoolUTXO[][] = [...rearrangeUTXOsWithChangeBySmallestDiff, ...rearrangeUTXOsNoChangeByHighestDiff];

        if (utxosJustToCoverAmountAndFee.length > 0 && totalJustToCoverAmountAndFee.gte(amountToSendJustToCover)) {
            validChoices.push(utxosJustToCoverAmountAndFee);
        }
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

    private async checkIfItCoversFee(txData: TransactionData, utxosToUse: MempoolUTXO[], utxosValue: BN): Promise<BN | null> {
        if (!txData.fee) {
            const tr = await this.createBitcoreTransaction(txData.source, txData.destination, txData.amount, undefined, txData.feePerKB, utxosToUse, true, txData.note);
            const txFee = toBN(tr.getFee());
            if (txFee.gtn(0) && utxosValue.lte(txData.amount.add(txFee))) {
                return txFee;
            }
        }
        return null;
    }

    async createBitcoreTransaction(
        source: string,
        destination: string,
        amountInSatoshi: BN,
        fee: BN | undefined,
        feePerKB: BN | undefined,
        utxos: MempoolUTXO[],
        useChange: boolean,
        note?: string,
        feeSource?: string,
        feeSourceRemainder?: BN,
    ): Promise<Transaction> {
        const updatedUtxos = await this.handleMissingUTXOScripts(utxos, source);
        const txUTXOs = updatedUtxos.map((utxo) => ({
            txid: utxo.transactionHash,
            outputIndex: utxo.position,
            scriptPubKey: utxo.script,
            satoshis: utxo.value.toNumber(),
        }) as UTXO);

        const core = getCore(this.chainType);
        const tr = new core.Transaction().from(txUTXOs.map((utxo) => new UnspentOutput(utxo))).to(destination, toNumber(amountInSatoshi));
        if (feeSourceRemainder && feeSource) {
            tr.to(feeSource, feeSourceRemainder.toNumber());
        }
        if (note) {
            tr.addData(Buffer.from(unPrefix0x(note), "hex"));
        }
        tr.enableRBF();
        if (fee) {
            tr.fee(toNumber(fee));
        } else if (feePerKB) {
            tr.feePerKb(feePerKB.toNumber());
        }
        if (useChange) {
            tr.change(source);
        }
        return tr;
    }
}
