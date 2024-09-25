import { TransactionEntity, TransactionStatus, UTXOEntity } from "../../src";
import { ChainType } from "../../src/utils/constants";
import { TransactionInputEntity } from "../../src/entity/transactionInput";
import { toBN } from "web3-utils";
import { IService } from "../../src/interfaces/IService";
import { BlockchainAPIWrapper } from "../../src/blockchain-apis/UTXOBlockchainAPIWrapper";
import axios, { AxiosInstance, AxiosResponse } from "axios";
import { BlockData, MempoolUTXO, MempoolUTXOMWithoutScript } from "../../src/interfaces/IBlockchainAPI";

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

export class MockBlockchainAPI implements IService, BlockchainAPIWrapper {
    client: AxiosInstance;
    clients: any;

    constructor() {
        this.clients = [];
        this.client = axios.create({});
    }

    async getAccountBalance(account: string): Promise<number | undefined> {
        return Promise.resolve(undefined);
    }

    async getCurrentBlockHeight(): Promise<BlockData> {
        return Promise.resolve({} as BlockData);
    }

    async getCurrentFeeRate(nextBlocks: number): Promise<number> {
        return Promise.resolve(0);
    }

    async getTransaction(txHash: string | undefined): Promise<AxiosResponse> {
        return Promise.resolve({ data: {} } as AxiosResponse);
    }

    async getUTXOScript(address: string, txHash: string, vout: number, chainType: ChainType): Promise<string> {
        return Promise.resolve("");
    }

    async getUTXOsFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXO[]> {
        return Promise.resolve([]);
    }

    async getUTXOsWithoutScriptFromMempool(address: string, chainType: ChainType): Promise<MempoolUTXOMWithoutScript[]> {
        return Promise.resolve([]);
    }

    async sendTransaction(tx: string): Promise<AxiosResponse> {
        return Promise.resolve({} as AxiosResponse);
    }
}
