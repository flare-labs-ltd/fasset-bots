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
            const nonce = await waitForNonceIncrease(web3, from, initialNonce, waitFor.pollMS, cancelToken);
            transactionLogger.info(`SUCCESS (nonce increase from ${initialNonce} to ${nonce})`, { transactionId, nonce });
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
                // console.log("Confirmation", confirmations);
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
export async function waitForNonceIncrease(web3: Web3, address: string, initialNonce: number, pollMS: number, cancelToken: CancelToken): Promise<number> {
    for (let i = 0; ; i++) {
        console.log(`Waiting nonce increase (read nonce): address=${address} time=${new Date().toISOString()}`);
        const nonce = await web3.eth.getTransactionCount(address, "latest");
        console.log(`Waiting nonce increase (from ${initialNonce}): address=${address} nonce=${nonce} time=${new Date().toISOString()}`);
        cancelToken.check(); // prevent returning value if cancelled
        if (nonce > initialNonce) {
            return nonce;
        };
        await cancelableSleep(pollMS, cancelToken);
    }
}

/* istanbul ignore next */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ignore(error: unknown) {
    // do nothing - the method can be used in promise `.catch()` to prevent
    // uncought error problems (when errors are properly caught elsewhere)
}
