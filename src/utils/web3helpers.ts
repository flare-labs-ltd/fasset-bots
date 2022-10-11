import Web3 from "web3";
import { web3 } from "./web3";

/**
 * Return latest block timestamp as number (seconds since 1.1.1970).
 */
export async function latestBlockTimestamp() {
    const block = await web3.eth.getBlock('latest');
    return Number(block.timestamp);
}

/**
 * Return latest block timestamp as BN (seconds since 1.1.1970).
 */
export async function latestBlockTimestampBN() {
    const block = await web3.eth.getBlock('latest');
    return Web3.utils.toBN(block.timestamp);
}
