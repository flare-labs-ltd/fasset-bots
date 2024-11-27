import {
    createTransactionInputEntity,
    findTransactionsWithStatuses,
    transactional,
    transformUTXOToTxInputEntity,
} from "../../db/dbutils";
import BN from "bn.js";
import { TransactionEntity, TransactionStatus } from "../../entity/transaction";
import { BTC_DOGE_DEC_PLACES, ChainType, MEMPOOL_CHAIN_LENGTH_LIMIT } from "../../utils/constants";
import { logger } from "../../utils/logger";
import { EntityManager, Loaded, RequiredEntityData } from "@mikro-orm/core";
import { FeeStatus } from "./TransactionFeeService";
import { toBN, toBNExp } from "../../utils/bnutils";
import { TransactionInputEntity } from "../../entity/transactionInput";
import { getDustAmount, isEnoughUTXOs } from "./UTXOUtils";
import { MempoolUTXO, UTXORawTransaction, UTXORawTransactionInput, UTXOVinResponse } from "../../interfaces/IBlockchainAPI";
import { UTXOBlockchainAPI } from "../../blockchain-apis/UTXOBlockchainAPI";
import { IUtxoWalletServices } from "./IUtxoWalletServices";

export interface TransactionData {
    source: string;
    destination: string;
    amount: BN;
    fee?: BN;
    feePerKB?: BN;
    useChange: boolean;
    note?: string;
}

export class TransactionUTXOService {
    private readonly chainType: ChainType;
    private readonly enoughConfirmations: number;

    readonly minimumUTXOValue: BN;

    private readonly services: IUtxoWalletServices;
    private readonly rootEm: EntityManager;
    private readonly blockchainAPI: UTXOBlockchainAPI;

    constructor(services: IUtxoWalletServices, chainType: ChainType, enoughConfirmations: number) {
        this.services = services;
        this.chainType = chainType;
        this.enoughConfirmations = enoughConfirmations;

        /* istanbul ignore next */
        if (this.chainType === ChainType.testDOGE || this.chainType === ChainType.DOGE) {
            this.minimumUTXOValue = toBNExp(0.1, BTC_DOGE_DEC_PLACES);
        } else if (this.chainType === ChainType.testBTC || this.chainType === ChainType.BTC) {
            this.minimumUTXOValue = toBNExp(0.0001, BTC_DOGE_DEC_PLACES); // 10k sats
        } else {
            this.minimumUTXOValue = toBNExp(0.0001, BTC_DOGE_DEC_PLACES); // 10k sats
        }

        this.rootEm = services.rootEm;
        this.blockchainAPI = services.blockchainAPI;
    }

    /**
     * Retrieves unspent transactions in format accepted by transaction
     * @param txData
     * @param rbfUTXOs
     * @returns {UTXOEntity[]}
     */
    async fetchUTXOs(txData: TransactionData, rbfedRawTx?: string): Promise<MempoolUTXO[]> {
        logger.info(`Listing UTXOs for address ${txData.source}`);
        const currentFeeStatus = await this.services.transactionFeeService.getCurrentFeeStatus();
        const unspentUTXOs = await this.filteredAndSortedMempoolUTXOs(txData.source);
        let rbfUTXOs: MempoolUTXO[] = []
        if (rbfedRawTx) {
            const rbfedRaw = JSON.parse(rbfedRawTx) as UTXORawTransaction;
            const rbfedInputs = rbfedRaw.inputs;
            rbfUTXOs = await this.createUTXOMempoolFromInputs(rbfedInputs);
        }
        const needed = await this.selectUTXOs(unspentUTXOs, rbfUTXOs, txData, currentFeeStatus);
        if (needed) {
            return needed;
        }
        return [];
    }

    // allUTXOs = currently available UTXOs (either from db or db + fetch from mempool)
    private async selectUTXOs(allUTXOs: MempoolUTXO[], rbfUTXOs: MempoolUTXO[], txData: TransactionData, feeStatus: FeeStatus): Promise<MempoolUTXO[] | null> {
        // filter out dust inputs
        const validUTXOs = allUTXOs.filter((utxo) => utxo.value.gte(getDustAmount(this.chainType)));
        const validRbfUTXOs = rbfUTXOs.filter((utxo) => utxo.value.gte(getDustAmount(this.chainType))); // should not be necessary

        if (validRbfUTXOs && validRbfUTXOs.length > 0) {
            logger.info(`Transaction got RBF UTXOs: ${validRbfUTXOs.map(t => {t.mintTxid.toString(), t.mintIndex.toString()})}`);
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
            // order by value, confirmed
            // utxos = this.sortUTXOs(utxos);
            res = await this.collectUTXOs(utxos, validRbfUTXOs, txData);
        } else if (feeStatus == FeeStatus.MEDIUM || feeStatus == FeeStatus.LOW) {
            // check if we can build tx with utxos with utxo.value < amountToSend
            const smallUTXOs = utxos.filter((utxo) => utxo.value.lte(txData.amount));
            if (isEnoughUTXOs(smallUTXOs, txData.amount, txData.fee)) {
                res = await this.collectUTXOs(smallUTXOs, validRbfUTXOs, txData);
            }
            if (!res) {
                res = await this.collectUTXOs(utxos, validRbfUTXOs, txData);
            }
        }

        if (res && (feeStatus == FeeStatus.HIGH || feeStatus == FeeStatus.MEDIUM)) {
            res = await this.removeExcessUTXOs(res, validRbfUTXOs.length, txData, feeStatus);
        }

        const maximumNumberOfUTXOs = this.getMaximumNumberOfUTXOs(feeStatus);
        if (res && !usingMinimalUTXOs && feeStatus == FeeStatus.LOW && res.length < maximumNumberOfUTXOs) {
            for (let i = 0; i < maximumNumberOfUTXOs - res.length && i < minimalUTXOs.length; i++) {
                res.push(minimalUTXOs[i]);
            }
        }

        return res;
    }

    private async collectUTXOs(utxos: MempoolUTXO[], rbfUTXOs: MempoolUTXO[], txData: TransactionData) {
        const baseUTXOs: MempoolUTXO[] = rbfUTXOs.slice(); // UTXOs needed for creating tx with >= 0 output
        const additionalUTXOs: MempoolUTXO[] = rbfUTXOs.slice(); // UTXOs needed for creating tx with >= minimalUTXOSize output

        const rbfUTXOsValueLeft = rbfUTXOs.length > 0 ? await this.calculateChangeValue(txData, baseUTXOs) : new BN(0);
        if (rbfUTXOsValueLeft.gte(this.minimumUTXOValue)) {
            return baseUTXOs;
        }

        let positiveValueReached = rbfUTXOsValueLeft.gt(getDustAmount(this.chainType)) && rbfUTXOs.length > 0;
        for (const utxo of utxos) {
            const numAncestors = await this.getNumberOfMempoolAncestors(utxo.mintTxid);
            if (numAncestors + 1 >= MEMPOOL_CHAIN_LENGTH_LIMIT) {
                logger.info(
                    `Number of UTXO mempool ancestors ${numAncestors} is >= than limit of ${MEMPOOL_CHAIN_LENGTH_LIMIT} for UTXO with hash ${utxo.mintIndex}`
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
        return ancestors.filter((t) => t.transactionHash !== txHash).length;
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
        if (txData.fee) {
            return valueBeforeFee.sub(txData.fee);
        } else if (calculatedTxFee.ltn(0)) {
            return toBN(-10); // return any negative value
        } else {
            return valueBeforeFee.sub(calculatedTxFee);
        }
    }

    private async getTransactionEntityByHash(txHash: string, inMempool: boolean = true) {
        let txEnt = await this.rootEm.findOne(TransactionEntity, { transactionHash: txHash }, { populate: ["inputs", "outputs"] });
        if (txEnt && txEnt.status != TransactionStatus.TX_SUBMISSION_FAILED) {
            const tr = await this.blockchainAPI.getTransaction(txHash);
            if (tr.blockHash && tr.confirmations >= this.enoughConfirmations) {
                txEnt.status = TransactionStatus.TX_SUCCESS;
                await this.rootEm.persistAndFlush(txEnt);
            }
        }
        if (!txEnt) {
            const tr = await this.blockchainAPI.getTransaction(txHash);
            /* istanbul ignore else */
            if ((tr && inMempool && tr.blockHash && tr.confirmations < this.enoughConfirmations) || (tr && !inMempool)) {
                logger.warn(`Tx with hash ${txHash} not in db, fetched from api`);
                await transactional(this.rootEm, async (em) => {
                    /* istanbul ignore next */
                    const txEnt = em.create(TransactionEntity, {
                        chainType: this.chainType,
                        source: tr.vin[0].addresses[0] ?? "FETCHED_VIA_API_UNKNOWN_SOURCE",
                        destination: "FETCHED_VIA_API_UNKNOWN_DESTINATION",
                        transactionHash: txHash,
                        fee: toBN(tr.fees),
                        status: tr.blockHash && tr.confirmations >= this.enoughConfirmations ? TransactionStatus.TX_SUCCESS : TransactionStatus.TX_SUBMITTED,
                    } as RequiredEntityData<TransactionEntity>);

                    const inputs = tr.vin.map((t: UTXOVinResponse) => createTransactionInputEntity(txEnt, t.txid, t.value, t.vout ?? 0, ""));
                    txEnt.inputs.add(inputs);

                    await em.persistAndFlush(txEnt);
                    await em.persistAndFlush(inputs);
                });
            }

            txEnt = await this.rootEm.findOne(TransactionEntity, { transactionHash: txHash }, { populate: ["inputs", "outputs"] });
        }

        return txEnt;
    }

    async handleMissingUTXOScripts(utxos: MempoolUTXO[]): Promise<MempoolUTXO[]> {
        for (const utxo of utxos) {
            if (!utxo.script) {
                const script = await this.blockchainAPI.getUTXOScript(utxo.mintTxid, utxo.mintIndex);
                utxo.script = script
            }
        }
        return utxos;
    }

    async createInputsFromUTXOs(dbUTXOs: MempoolUTXO[], txId: number) {
        const inputs: TransactionInputEntity[] = [];
        for (const utxo of dbUTXOs) {
            const tx = await this.getTransactionEntityByHash(utxo.mintTxid, false);
            /* istanbul ignore else */
            if (tx) {
                inputs.push(transformUTXOToTxInputEntity(utxo, tx));
            } else {
                logger.warn(`Transaction ${txId}: Transaction (utxo) with hash ${utxo.mintTxid} could not be found on api`);
            }
        }
        await this.rootEm.persistAndFlush(inputs);
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

    private async findTransactionInputsBySourceAndStatuses(source: string): Promise<Set<String>> {
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
        console.log("mempoolUTXOs", mempoolUTXOs)
        const pendingInputs = await this.findTransactionInputsBySourceAndStatuses(source);
        console.log("pendingInputs", pendingInputs)
        const filteredMempoolUTXOs = mempoolUTXOs.filter(
            utxo => !pendingInputs.has(`${utxo.mintIndex}:${utxo.mintIndex}`)
        );
        console.log("filteredMempoolUTXOs", filteredMempoolUTXOs)
        // sort by confirmed and then by value (descending)
        const sortedMempoolUTXOs = filteredMempoolUTXOs.sort((a, b) => {
            if (a.confirmed !== b.confirmed) {
                return b.confirmed ? 1 : -1;
            }
            const aValue = (a.value);
            const bValue = (b.value);
            return Number(aValue.sub(bValue));
        });
        return sortedMempoolUTXOs;
    }

    private async createUTXOMempoolFromInputs(inputs: UTXORawTransactionInput[]): Promise<MempoolUTXO[]> {
        const mempoolRbfUTXOs: MempoolUTXO[] = [];
        for (const input of inputs) {
            const mempoolRbfUTXO: MempoolUTXO = {
                mintTxid: input.prevTxId,
                mintIndex: input.outputIndex,
                value: toBN(input.output.satoshis),
                confirmed: false,
                script: await this.blockchainAPI.getUTXOScript(input.prevTxId, input.outputIndex)
            };
            mempoolRbfUTXOs.push(mempoolRbfUTXO);
        }
        return mempoolRbfUTXOs;
    }
}
