import {
    createTransactionInputEntity,
    findTransactionsWithStatuses,
    transactional,
    transformUTXOToTxInputEntity
} from "../../db/dbutils";
import BN from "bn.js";
import {TransactionEntity, TransactionStatus} from "../../entity/transaction";
import {
    ChainType,
    MEMPOOL_CHAIN_LENGTH_LIMIT,
} from "../../utils/constants";
import {logger} from "../../utils/logger";
import {EntityManager, Loaded, RequiredEntityData} from "@mikro-orm/core";
import {FeeStatus} from "./TransactionFeeService";
import {toBN} from "../../utils/bnutils";
import {TransactionInputEntity} from "../../entity/transactionInput";
import {
    getDustAmount,
    getMinimumUTXOValue,
    getRelayFeePerKB,
    isEnoughUTXOs
} from "./UTXOUtils";
import {
    MempoolUTXO,
    UTXORawTransaction,
    UTXORawTransactionInput,
    UTXOVinResponse
} from "../../interfaces/IBlockchainAPI";
import {UTXOBlockchainAPI} from "../../blockchain-apis/UTXOBlockchainAPI";
import {IUtxoWalletServices} from "./IUtxoWalletServices";
import { between, estimateTxSize } from "../../utils/utils";

export interface TransactionData {
    source: string;
    destination: string;
    amount: BN;
    fee?: BN;
    feePerKB?: BN;
    useChange: boolean;
    note?: string;
    replacementFor?: TransactionEntity;
    maxFee?: BN
}

export class TransactionUTXOService {
    private readonly chainType: ChainType;
    private readonly enoughConfirmations: number;

    readonly minimumUTXOValue: BN;

    private readonly services: IUtxoWalletServices;
    private readonly rootEm: EntityManager;
    private readonly blockchainAPI: UTXOBlockchainAPI;

    // <address, Map<hash:vout, script>>
    private utxoScriptMap: Map<string, Map<string, string>>;
    private timestampTracker: number;

    constructor(services: IUtxoWalletServices, chainType: ChainType, enoughConfirmations: number) {
        this.services = services;
        this.chainType = chainType;
        this.enoughConfirmations = enoughConfirmations;

        /* istanbul ignore next */
        this.minimumUTXOValue = getMinimumUTXOValue(this.chainType);

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
     * @param rbfUTXOs
     * @returns {UTXOEntity[]}
     */
    async fetchUTXOs(txData: TransactionData, rbfedRawTx?: string): Promise<MempoolUTXO[]> {
        await this.removeOldUTXOScripts();

        logger.info(`Listing UTXOs for address ${txData.source}`);
        const currentFeeStatus = await this.services.transactionFeeService.getCurrentFeeStatus();
        const unspentUTXOs = await this.filteredAndSortedMempoolUTXOs(txData.source);
        let rbfUTXOs: MempoolUTXO[] = []
        if (rbfedRawTx) {
            const rbfedRaw = JSON.parse(rbfedRawTx) as UTXORawTransaction;
            const rbfedInputs = rbfedRaw.inputs;
            rbfUTXOs = await this.createUTXOMempoolFromInputs(txData.source, rbfedInputs);
        }
        const needed = await this.selectUTXOs(unspentUTXOs, rbfUTXOs, txData, currentFeeStatus);
        if (needed) {
            return needed;
        }
        return [];
    }

    private async selectUTXOs(allUTXOs: MempoolUTXO[], rbfUTXOs: MempoolUTXO[], txData: TransactionData, feeStatus: FeeStatus): Promise<MempoolUTXO[] | null> {
        // filter out dust inputs
        const validUTXOs = allUTXOs.filter((utxo) => utxo.value.gte(getDustAmount(this.chainType)));
        const validRbfUTXOs = rbfUTXOs.filter((utxo) => utxo.value.gte(getDustAmount(this.chainType))); // should not be necessary

        if (validRbfUTXOs && validRbfUTXOs.length > 0) {
            logger.info(`Transaction got RBF UTXOs: ${validRbfUTXOs.map(t => `${t.transactionHash.toString()}, ${t.position.toString()}`).join('; ')}`);
        }

        if (!isEnoughUTXOs(rbfUTXOs.concat(allUTXOs), txData.amount, txData.fee)) {
            logger.info(`Account doesn't have enough UTXOs - Skipping selection.
                Amount: ${txData.amount.toNumber()},
                UTXO values: [${rbfUTXOs.concat(allUTXOs).map(t => t.value.toNumber()).join(', ')}],
                ${txData.fee ? "fee" : "feePerKB"}: ${txData.fee?.toNumber() ?? txData.feePerKB?.toNumber()}`
            );
            return null;
        }

        const minimalUTXOs = validUTXOs.filter((utxo) => utxo.value.lt(this.minimumUTXOValue));
        const notMinimalUTXOs = validUTXOs.filter((utxo) => utxo.value.gte(this.minimumUTXOValue));

        let utxos: MempoolUTXO[] = notMinimalUTXOs;
        let usingMinimalUTXOs = false; // If we're using the UTXOs which are < this.minimumUTXOValue
        if (!isEnoughUTXOs(validRbfUTXOs.concat(notMinimalUTXOs), txData.amount, txData.fee)) {
            utxos = validUTXOs;
            usingMinimalUTXOs = true;
        }
        if (rbfUTXOs.length > 0) {
            utxos = utxos.filter(t => t.confirmed);
        }

        let res: MempoolUTXO[] | null = null;
        /* istanbul ignore else */
        if (feeStatus == FeeStatus.HIGH) {
            res = await this.collectUTXOs(utxos, validRbfUTXOs, txData);
            if (res) {
                res = await this.removeExcessUTXOs(res, validRbfUTXOs.length, txData, feeStatus);
            }
        } else if (feeStatus == FeeStatus.MEDIUM || feeStatus == FeeStatus.LOW) {
            // check if we can build tx with utxos with utxo.value < amountToSend
            const smallUTXOs = utxos.filter((utxo) => utxo.value.lte(txData.amount));
            if (isEnoughUTXOs(smallUTXOs, txData.amount, txData.fee)) {
                res = await this.collectUTXOs(smallUTXOs, validRbfUTXOs, txData, true);
                if (res && feeStatus == FeeStatus.MEDIUM) {
                    res = await this.removeExcessUTXOs(res, validRbfUTXOs.length, txData, feeStatus);
                }
                if (res && txData.maxFee) {
                    const transactionService = this.services.transactionService;
                    const tr = await transactionService.createBitcoreTransaction(
                        txData.source,
                        txData.destination,
                        txData.amount,
                        txData.fee,
                        txData.feePerKB,
                        res,
                        txData.useChange,
                        txData.note
                    );
                    const currentFee = toBN(tr.getFee());
                    if (currentFee.gt(txData.maxFee)) {
                        res = null;
                    }
                }
            }
            if (!res) { // use the default algorithm
                res = await this.collectUTXOs(utxos, validRbfUTXOs, txData);
            }
        }

        const maximumNumberOfUTXOs = this.getMaximumNumberOfUTXOs(feeStatus);
        if (res && !usingMinimalUTXOs && feeStatus == FeeStatus.LOW && res.length < maximumNumberOfUTXOs) {
            for (let i = 0; i < maximumNumberOfUTXOs - res.length && i < minimalUTXOs.length; i++) {
                res.push(minimalUTXOs[i]);
            }
        }

        return res;
    }

    private async collectUTXOs(utxos: MempoolUTXO[], rbfUTXOs: MempoolUTXO[], txData: TransactionData, useUTXOsLessThanAmount?: boolean) {
        const baseUTXOs: MempoolUTXO[] = rbfUTXOs.slice(); // UTXOs needed for creating tx with >= 0 output
        const rbfUTXOsValueLeft = rbfUTXOs.length > 0 ? await this.calculateChangeValue(txData, baseUTXOs) : new BN(0);
        if (rbfUTXOsValueLeft.gte(this.minimumUTXOValue)) {
            return baseUTXOs;
        }

        // If there is an UTXO that covers amount use it, otherwise default to selection algorithm
        const res = useUTXOsLessThanAmount === true ? null : await this.collectUTXOsMinimal(utxos, rbfUTXOs, txData);
        if (res) {
            return res;
        } else {
            return this.collectUTXOsFailover(utxos, rbfUTXOs, txData);
        }
    }

    private async collectUTXOsFailover(utxos: MempoolUTXO[], rbfUTXOs: MempoolUTXO[], txData: TransactionData) {
        const baseUTXOs: MempoolUTXO[] = rbfUTXOs.slice(); // UTXOs needed for creating tx with >= 0 output
        const additionalUTXOs: MempoolUTXO[] = rbfUTXOs.slice(); // UTXOs needed for creating tx with >= minimalUTXOSize output

        const rbfUTXOsValueLeft = rbfUTXOs.length > 0 ? await this.calculateChangeValue(txData, baseUTXOs) : new BN(0);
        let positiveValueReached = rbfUTXOsValueLeft.gt(getDustAmount(this.chainType)) && rbfUTXOs.length > 0;
        for (const utxo of utxos) {
            const numAncestors = await this.getNumberOfMempoolAncestors(utxo.transactionHash);
            if (numAncestors + 1 >= MEMPOOL_CHAIN_LENGTH_LIMIT) {
                logger.info(
                    `Number of UTXO mempool ancestors ${numAncestors} is >= than limit of ${MEMPOOL_CHAIN_LENGTH_LIMIT} for UTXO with hash ${utxo.transactionHash} and position ${utxo.position}`
                );
                continue; //skip this utxo
            }

            if (!positiveValueReached) {
                baseUTXOs.push(utxo);
                additionalUTXOs.push(utxo);
                const satisfiedChangeForBase = (await this.calculateChangeValue(txData, baseUTXOs)).gt(getDustAmount(this.chainType));
                positiveValueReached = satisfiedChangeForBase;
            } else {
                if (utxo.confirmed) {
                    additionalUTXOs.push(utxo);
                }
            }
            const satisfiedChangeForAdditional = (await this.calculateChangeValue(txData, additionalUTXOs)).gte(this.minimumUTXOValue);
            if (satisfiedChangeForAdditional) {
                return additionalUTXOs;
            }
        }

        if (!positiveValueReached) {
            logger.info(
                `Failed to collect enough UTXOs to cover amount and fee.
                    Amount: ${txData.amount.toNumber()},
                    UTXO values: [${baseUTXOs.map(t => t.value.toNumber()).join(', ')}],
                    ${txData.fee ? "fee" : "feePerKB"}: ${txData.fee?.toNumber() ?? txData.feePerKB?.toNumber()}`
            );
        }
        return positiveValueReached ? baseUTXOs : null;
    }

    private async collectUTXOsMinimal(utxos: MempoolUTXO[], rbfUTXOs: MempoolUTXO[], txData: TransactionData) {
        for (let i = utxos.length - 1; i > -1; i--) {
            const utxo = utxos[i];
            const numAncestors = await this.getNumberOfMempoolAncestors(utxo.transactionHash);
            if (numAncestors + 1 >= MEMPOOL_CHAIN_LENGTH_LIMIT) {
                logger.info(
                    `Number of UTXO mempool ancestors ${numAncestors} is >= than limit of ${MEMPOOL_CHAIN_LENGTH_LIMIT} for UTXO with hash ${utxo.transactionHash} and position ${utxo.position}`
                );
                continue; //skip this utxo
            }

            const utxoList = [...rbfUTXOs, utxo];
            const changeValue = await this.calculateChangeValue(txData, utxoList);
            if (changeValue.gtn(0) && between(changeValue, getDustAmount(this.chainType), this.minimumUTXOValue)) {
                let smallestUTXOIndex = -1;
                for (let j = utxos.length - 1; j > 0; j--) {
                    if (j !== i && 1 + (await this.getNumberOfMempoolAncestors(utxos[j].transactionHash)) < 25) {
                        smallestUTXOIndex = j;
                        break;
                    }
                }
                if (smallestUTXOIndex < 0) {
                    return null;
                }

                return [...utxoList, utxos[smallestUTXOIndex]];
            } else if (between(changeValue, toBN(0), getDustAmount(this.chainType))) {
                return utxoList;
            }
        }

        return null;
    }

    private async removeExcessUTXOs(utxos: MempoolUTXO[], rbfUTXOsLength: number, txData: TransactionData, feeStatus: FeeStatus) {
        const baseUTXOs: MempoolUTXO[] = utxos.slice(0, rbfUTXOsLength); // UTXOs needed for creating tx with >= 0 output
        const additionalUTXOs: MempoolUTXO[] = utxos.slice(0, rbfUTXOsLength); // UTXOs needed for creating tx with >= minimalUTXOSize output

        const nonRbfUTXOs = this.sortUTXOs(utxos.slice(rbfUTXOsLength));
        let positiveValueReached = false;

        if (nonRbfUTXOs.length === 0) {
            return utxos;
        }

        for (const utxo of nonRbfUTXOs) {
            if (!positiveValueReached) {
                baseUTXOs.push(utxo);
            }
            additionalUTXOs.push(utxo);

            if (!positiveValueReached && (await this.calculateChangeValue(txData, baseUTXOs)).gt(getDustAmount(this.chainType))) {
                positiveValueReached = true;
            }
            if ((await this.calculateChangeValue(txData, additionalUTXOs)).gte(this.minimumUTXOValue) && (additionalUTXOs.length - baseUTXOs.length) < this.getMaximumNumberOfUTXOs(feeStatus) / 2) {
                return additionalUTXOs;
            }
        }

        return positiveValueReached ? baseUTXOs : null;
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

    private async calculateChangeValue(txData: TransactionData, utxos: MempoolUTXO[]): Promise<BN> {
        const transactionService = this.services.transactionService;
        const tr = await transactionService.createBitcoreTransaction(
            txData.source,
            txData.destination,
            txData.amount,
            txData.fee,
            txData.feePerKB,
            utxos,
            txData.useChange,
            txData.note
        );
        const valueBeforeFee = utxos.reduce((acc, utxo) => acc.add(utxo.value), new BN(0)).sub(txData.amount);
        const calculatedTxFee = toBN(tr.getFee());
        if (txData.fee && txData.fee.gtn(0)) {
            const size = Math.ceil(estimateTxSize(this.chainType, tr));
            const relayFeePerB = getRelayFeePerKB(this.chainType).muln(this.services.transactionFeeService.feeIncrease).divn(1000).divn(1000);
            return txData.replacementFor ? valueBeforeFee.sub(txData.fee).sub(toBN(size).mul(relayFeePerB)) : valueBeforeFee.sub(txData.fee);
        } else if (calculatedTxFee.ltn(0)) {
            return toBN(-10); // return any negative value
        } else {
            return valueBeforeFee.sub(calculatedTxFee);
        }
    }

    private async getTransactionEntityByHash(txHash: string) {
        let txEnt = await this.rootEm.findOne(TransactionEntity, { transactionHash: txHash, chainType: this.chainType }, { populate: ["inputs"] });
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
                        source: tr.vin[0]?.addresses?.[0] ?? "FETCHED_VIA_API_UNKNOWN_SOURCE",
                        destination: "FETCHED_VIA_API_UNKNOWN_DESTINATION",
                        transactionHash: txHash,
                        fee: toBN(tr.fees),
                        status: tr.blockHash && tr.confirmations >= this.enoughConfirmations ? TransactionStatus.TX_SUCCESS : TransactionStatus.TX_SUBMITTED,
                        numberOfOutputs: tr.vout.length ?? 0
                    } as RequiredEntityData<TransactionEntity>);

                    const inputs: TransactionInputEntity[] = []
                    for (const t of tr.vin) {
                        if (t.txid && t.value && t.vout) {
                            inputs.push(createTransactionInputEntity(em, txEnt, t.txid, t.value, t.vout, ""));
                        }
                    }
                    txEnt.inputs.add(inputs);

                    em.persist(txEnt);
                });
            }

            txEnt = await this.rootEm.findOne(TransactionEntity, { transactionHash: txHash, chainType: this.chainType }, { populate: ["inputs"] });
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

    private sortUTXOs(utxos: MempoolUTXO[]) {
        return utxos.sort((a, b) => {
            if (a.confirmed === b.confirmed) {
                const valueComparison = b.value.sub(a.value).toNumber(); // if they are both confirmed or unconfirmed, sort by value
                if (valueComparison === 0) { // if values are also the same => shuffle randomly
                    return Math.random() < 0.5 ? -1 : 1;
                }
                return valueComparison;
            }
            return Number(b.confirmed) - Number(a.confirmed);
        });
    }

    private getMaximumNumberOfUTXOs(status: FeeStatus) {
        switch (status) {
            case FeeStatus.HIGH:
                return 10;
            case FeeStatus.MEDIUM:
                return 15;
            case FeeStatus.LOW:
                return 20;
        }
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

    async filteredAndSortedMempoolUTXOs(source: string): Promise<MempoolUTXO[]> {
        const mempoolUTXOs = await this.blockchainAPI.getUTXOsFromMempool(source);
        const pendingInputs = await this.findTransactionInputsBySourceAndStatuses(source);
        const filteredMempoolUTXOs = mempoolUTXOs.filter(
            utxo => !pendingInputs.has(`${utxo.transactionHash}:${utxo.position}`)
        );
        // sort by confirmed and then by value (descending)
        const sortedMempoolUTXOs = filteredMempoolUTXOs.sort((a, b) => {
            if (a.confirmed !== b.confirmed) {
                return b.confirmed ? 1 : -1;
            }
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
