import Web3 from "web3";
import { BlockNumber } from "web3-core";
import { web3 } from "./web3";
import BN from "bn.js";

/**
 * Return latest block timestamp as number (seconds since 1.1.1970).
 */
export async function latestBlockTimestamp() {
    const block = await web3.eth.getBlock("latest");
    return Number(block.timestamp);
}

/**
 * Return block timestamp as number (seconds since 1.1.1970).
 */
export async function blockTimestamp(blockNumber: BlockNumber) {
    const block = await web3.eth.getBlock(blockNumber);
    return Number(block.timestamp);
}

/**
 * Return latest block timestamp as BN (seconds since 1.1.1970).
 */
export async function latestBlockTimestampBN(): Promise<BN> {
    const block = await web3.eth.getBlock("latest");
    return Web3.utils.toBN(block.timestamp);
}
