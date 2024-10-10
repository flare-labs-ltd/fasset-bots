import Web3 from 'web3';
import * as fs from 'fs';
import { glob} from 'glob';
import { logger } from "../utils/logger";
import { sleep } from './helpers';

export function waitFinalize3Factory(web3: Web3) {
    return async (address: string, func: () => any, delay: number = 1000) => {
        const nonce = await web3.eth.getTransactionCount(address);
        const res = await func();
        const backoff = 1.5;
        let cnt = 0;
        while ((await web3.eth.getTransactionCount(address)) === nonce) {
            await new Promise((resolve: any) => {
                setTimeout(() => {
                    resolve();
                }, delay);
            });
            if (cnt < 8) {
                delay = Math.floor(delay * backoff);
                cnt++;
            } else {
                throw new Error('Response timeout');
            }
            logger.info(`Delay backoff ${delay} (${cnt})`);
        }
        return res;
    };
}

export async function getContractAbi(abiPath: string) {
    let abi = JSON.parse(fs.readFileSync(abiPath).toString());
    if (abi.abi) {
        abi = abi.abi;
    }
    return abi;
}

export function getUnixEpochTimestamp() {
    return Math.floor(Date.now() / 1000);
}

export async function getWeb3Contract(web3: any, address: string, name: string): Promise<any> {
    let abiPath = '';
    try {
        abiPath = await relativeContractABIPathForContractName(name, 'packages/fasset-bots-core/artifacts');
        const abi = getAbi(`packages/fasset-bots-core/artifacts/${abiPath}`);
        return new web3.eth.Contract(abi, address);
    } catch (e: any) {
        logger.error(`getWeb3Contract error - ABI not found: ${e}`);
    }
}

export async function relativeContractABIPathForContractName(name: string, artifactsRoot = 'artifacts'): Promise<string> {
    const files = await glob(`**/${name}.sol/${name}.json`, { cwd: artifactsRoot });
    return files[0];
}

export function getAbi(abiPath: string) {
    let abi = JSON.parse(fs.readFileSync(abiPath).toString());
    if (abi.abi) {
        abi = abi.abi;
    }
    return abi;
}

export function waitFinalize(web3: Web3, options: WaitFinalizeOptions = waitFinalizeDefaults) {
    return async (address: string, func: () => Promise<any>) => {
        const nonce = await web3.eth.getTransactionCount(address);
        const res = await func();
        while (await web3.eth.getTransactionCount(address) == nonce) {
            await sleep(options.sleepMS);
        }
        for (let i = 0; i < options.retries; i++) {
            const block = await web3.eth.getBlockNumber();
            while (await web3.eth.getBlockNumber() - block < options.extraBlocks) {
                await sleep(options.sleepMS);
            }
            // only end if the nonce didn't revert (and repeat up to 3 times)
            if (await web3.eth.getTransactionCount(address) > nonce) break;
            logger.warn(`Nonce reverted after ${i + 1} retries, retrying again...`);
        }
        return res;
    }
}

export const waitFinalizeDefaults: WaitFinalizeOptions = { extraBlocks: 2, retries: 3, sleepMS: 1000 };

export interface WaitFinalizeOptions {
    extraBlocks: number;
    retries: number;
    sleepMS: number;
}