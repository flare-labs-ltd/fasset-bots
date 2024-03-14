import Web3 from "web3";
import { PromiEvent, TransactionReceipt } from "web3-core";
import { CancelToken, CancelTokenRegistration, cancelableSleep } from "./cancelable-promises";
import { captureStackTrace, fixErrorStack, transactionLogger } from "./transaction-logging";
import { TransactionWaitFor } from "./types";

export class FinalizationTimeoutError extends Error {}

/**
 * Wait for finalization of a method, depending on the provided `waitFor` parameter.
 * @param web3 The web3 instance to use for network connections.
 * @param waitFor Specifies the finalization method.
 * @param initialNonce The nonce of `from` addres before the transaction was sent.
 * @param from The address that initiated the transaction.
 * @param promiEvent The web3 transaction send result.
 * @returns Transaction receipt.
 */
export async function waitForFinalization(
    transactionId: number,
    web3: Web3,
    waitFor: TransactionWaitFor,
    initialNonce: number,
    from: string,
    promiEvent: PromiEvent<TransactionReceipt>,
    cancelToken: CancelToken
) {
    async function waitForFinalizationInner() {
        if (waitFor.what === "receipt") {
            transactionLogger.info("SUCCESS (receipt)", { transactionId });
        } else if (waitFor.what === "confirmations") {
            await waitForConfirmations(promiEvent, waitFor.confirmations, cancelToken);
            transactionLogger.info("SUCCESS (confirmations)", { transactionId });
        } /* waitFor.what === 'nonceIncrease' */ else {
            const { nonce, extraBlocks, extraTime } = await waitForNonceIncrease(web3, from, initialNonce, waitFor.pollMS, waitFor.extra, cancelToken);
            transactionLogger.info(`SUCCESS (nonce increase from ${initialNonce} to ${nonce})`, { transactionId, nonce, extraBlocks, extraTime });
        }
    }
    async function waitForTimeout(timeoutMS: number) {
        // on Node, we must create error here to get the correct stack trace
        const error = new FinalizationTimeoutError("Timeout waiting for finalization");
        await cancelableSleep(timeoutMS, cancelToken);
        throw error;
    }
    if (waitFor.timeoutMS) {
        await Promise.race([waitForFinalizationInner(), waitForTimeout(waitFor.timeoutMS)]);
    } else {
        await waitForFinalizationInner();
    }
}

/**
 * Wait for receipt. Just like `await promiEvent`, except that this is cancelable.
 * @param promiEvent The web3 transaction send result.
 * @param cancelToken The token that allows for cancelling the wait.
 */
export function waitForReceipt(promiEvent: PromiEvent<TransactionReceipt>, cancelToken: CancelToken): Promise<TransactionReceipt> {
    let cancelRegistration: CancelTokenRegistration;
    return new Promise<TransactionReceipt>((resolve, reject) => {
        promiEvent.on("receipt", (receipt) => resolve(receipt)).catch(ignore);
        const parentStack = captureStackTrace(2);
        promiEvent.on("error", (error) => reject(fixErrorStack(error, parentStack))).catch(ignore);
        cancelRegistration = cancelToken.register(reject);
    }).finally(() => {
        cancelRegistration.unregister();
        (promiEvent as any).off("receipt");
        (promiEvent as any).off("error");
    });
}

/**
 * Wait for given number of confirmations.
 * @param promiEvent The web3 method call result.
 * @param confirmationsRequired Number of confirmations to wait for.
 * @param cancelToken The token that allows for cancelling the wait.
 * @returns Transaction receipt.
 */
export function waitForConfirmations(promiEvent: PromiEvent<any>, confirmationsRequired: number, cancelToken: CancelToken): Promise<TransactionReceipt> {
    let cancelRegistration: CancelTokenRegistration;
    return new Promise<TransactionReceipt>((resolve, reject) => {
        promiEvent
            .on("confirmation", (confirmations, receipt) => {
                if (confirmations >= confirmationsRequired) {
                    resolve(receipt);
                }
            })
            .catch(ignore);
        const parentStack = captureStackTrace(2);
        promiEvent.on("error", (error) => reject(fixErrorStack(error, parentStack))).catch(ignore);
        cancelRegistration = cancelToken.register(reject);
    }).finally(() => {
        cancelRegistration.unregister();
        (promiEvent as any).off("confirmation");
        (promiEvent as any).off("error");
    });
}

/**
 * Wait for nonce of the `address` to increase from `initialNonce` value.
 * @param web3 The web3 instance to use for network connections.
 * @param address The address that initiated the transaction.
 * @param initialNonce The nonce of `from` addres before the transaction was sent.
 * @param pollMS Number of milliseconds between each nonce check.
 * @param cancelToken The token that allows for cancelling the wait.
 */
export async function waitForNonceIncrease(
    web3: Web3,
    address: string,
    initialNonce: number,
    pollMS: number,
    extra: { blocks: number; timeMS: number } | undefined,
    cancelToken: CancelToken
): Promise<{ nonce: number; extraBlocks: number; extraTime: number }> {
    let startBlock = -1;
    let startTime = -1;
    for (let i = 0; ; i++) {
        const nonce = await web3.eth.getTransactionCount(address, "latest");
        if (nonce > initialNonce) {
            if (extra == null) {
                cancelToken.check(); // prevent returning value if cancelled
                return { nonce, extraBlocks: 0, extraTime: 0 };
            } else if (startBlock < 0) {
                // start waiting for block increase or extra time to pass
                startBlock = await web3.eth.getBlockNumber();
                startTime = new Date().getTime();
            } else {
                const block = await web3.eth.getBlockNumber();
                const time = new Date().getTime();
                if (block >= startBlock + extra.blocks || time >= startTime + extra.timeMS) {
                    cancelToken.check(); // prevent returning value if cancelled
                    return { nonce, extraBlocks: block - startBlock, extraTime: time - startTime };
                }
            }
        } else if (startBlock >= 0) {
            // nonce decreased while waiting - possibly a network reorg
            const block = await web3.eth.getBlockNumber();
            const time = new Date().getTime();
            transactionLogger.warn(`NONCE DECREASE - restarting extra block count (initial=${initialNonce} >= current=${nonce}, extra blocks=${block - startBlock}, extra time=${time - startTime})`,
                { initialNonce, nonce, extraBlocks: block - startBlock, extraTime: time - startTime });
            // if nonce fell back during wait for extra blocks, require full wait again
            startBlock = -1;
            startTime = -1;
        }
        await cancelableSleep(pollMS, cancelToken);
    }
}

/* istanbul ignore next */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ignore(error: unknown) {
    // do nothing - the method can be used in promise `.catch()` to prevent
    // uncought error problems (when errors are properly caught elsewhere)
}
