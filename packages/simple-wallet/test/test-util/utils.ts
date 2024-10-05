import { TransactionEntity, TransactionStatus, UTXOEntity } from "../../src";
import { ChainType } from "../../src/utils/constants";
import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { toBN } from "web3-utils";
import { BlockchainAPIWrapper } from "../../src/blockchain-apis/UTXOBlockchainAPIWrapper";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { MempoolUTXO, MempoolUTXOMWithoutScript } from "../../src/interfaces/IBlockchainAPI";

export function createTransactionEntity(source: string, destination: string, txHash: string, utxos?: UTXOEntity[], inputs?: TransactionEntity[], status?: TransactionStatus): TransactionEntity {
    const txEnt = new TransactionEntity();
    txEnt.chainType = ChainType.testBTC;
    txEnt.status = status ?? TransactionStatus.TX_SUCCESS;
    txEnt.source = source;
    txEnt.transactionHash = txHash;
    txEnt.destination = destination;
    txEnt.utxos.set(utxos ?? []);
    if (inputs) {
        txEnt.inputs.set(inputs.map(t => createTransactionInputEntity(t.transactionHash!, 0)));
    }
    return txEnt;
}


export function createTransactionInputEntity(transactionHash: string, vout: number) {
    const inputEnt = new TransactionInputEntity();
    inputEnt.transactionHash = transactionHash;
    inputEnt.vout = vout;
    inputEnt.amount = toBN(0);
    inputEnt.script = "";
    return inputEnt;
}

export class MockBlockchainAPI implements BlockchainAPIWrapper {
    client: AxiosInstance;
    clients: any;
    chainType: ChainType;

    constructor() {
        this.clients = [];
        this.client = axios.create({});
        this.chainType = ChainType.testBTC;
    }

    getBlockTimeAt(blockNumber: number): Promise<import("bn.js")> {
        return Promise.resolve(toBN(0));
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        return Promise.resolve(undefined);
    }

    async getCurrentBlockHeight(): Promise<number> {
        return Promise.resolve(0);
    }

    async getCurrentFeeRate(): Promise<number> {
        return Promise.resolve(0);
    }

    async getTransaction(txHash: string | undefined): Promise<AxiosResponse> {
        return Promise.resolve({ data: {} } as AxiosResponse);
    }

    async getUTXOScript(txHash: string, vout: number): Promise<string> {
        return Promise.resolve("");
    }

    async getUTXOsFromMempool(address: string): Promise<MempoolUTXO[]> {
        return Promise.resolve([]);
    }

    async getUTXOsWithoutScriptFromMempool(address: string): Promise<MempoolUTXOMWithoutScript[]> {
        return Promise.resolve([]);
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return Promise.resolve({} as AxiosResponse);
    }
}
