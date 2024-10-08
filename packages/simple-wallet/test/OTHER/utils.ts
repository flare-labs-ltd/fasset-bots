import { SpentHeightEnum, TransactionEntity, UTXOEntity } from "../../src";
import BN from "bn.js";

export function createUTXOEntity(id: number, source: string, mintTransactionHash: string, position: 0, spentHeight: SpentHeightEnum, value: BN, script: string) {
    const utxoEnt = new UTXOEntity();
    utxoEnt.id = id;
    utxoEnt.source = source;
    utxoEnt.mintTransactionHash = mintTransactionHash;
    utxoEnt.position = position;
    utxoEnt.spentHeight = spentHeight;
    utxoEnt.script = script;
    utxoEnt.value = value;
    return utxoEnt;
}

export function createTransactionEntity(id: number, source: string, destination: string, fee: BN, utxos: UTXOEntity[]) {
    const txEnt = new TransactionEntity();
    txEnt.id = id;
    txEnt.source = source;
    txEnt.destination = destination;
    txEnt.fee = fee;
    txEnt.utxos.set(utxos);
    return txEnt;
}