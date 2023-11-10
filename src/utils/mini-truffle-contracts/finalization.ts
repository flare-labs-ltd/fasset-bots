import Web3 from "web3";
import { BN_ZERO, maxBN, sleep, toBN } from "../helpers";
import { CancelToken, CancelTokenRegistration, PromiseCancelled, cancelableSleep } from "./cancelable-promises";
import { transactionLogger, wrapTransactionError } from "./transaction-logging";
import { ContractSettings, TransactionWaitFor } from "./types";

export class FinalizationTimeoutError extends Error { }

/**
 * Submit transactions and later resubmit with higher gas price if necessary.
 * Never executes new transaction from an address before the previous is mined (nonce must increase).
 * After receipt is obtained, wait for finalization.
 * @param transactionId numeric transaction id, to identify transaction for logging
 * @param settings mini truffle contract settings
 * @param config the transaction config to for `web3.eth.sendTransaction()`
 * @returns transaction receipt if successful
 */
export async function submitTransaction(transactionId: number, settings: ContractSettings, config: TransactionConfig) {
    const fromAddress = config.from as string;
    const nonce = await lockAddressNonce(settings, fromAddress);
    transactionLogger.info("SUBMIT", { transactionId, waitFor: settings.waitFor, nonce });
    // resubmit transaction item with afterMS=0 is optional in settings - it can be added if you want the initial price factor to be different from 1
    let resubmitTransaction = settings.resubmitTransaction;
    if (resubmitTransaction.find(it => it.afterMS === 0) == null) {
        resubmitTransaction = [{ afterMS: 0, priceFactor: 1 }, ...resubmitTransaction];
    }
    const cancelToken = new CancelToken();
    let currentGasPrice = BN_ZERO;
    const resubmits = resubmitTransaction.map(async (resubmit, index) => {
        if (resubmit.afterMS > 0) {
            await cancelableSleep(resubmit.afterMS, cancelToken);
        }
        // maxBN is here because currentGasPrice should increase with time so that each next submission has at least 10% higher price (of course, price factors must grow sufficiently)
        currentGasPrice = maxBN(currentGasPrice, toBN(config.gasPrice ?? await settings.web3.eth.getGasPrice()));
        const gasPrice = currentGasPrice.muln(resubmit.priceFactor);
        const cfg: TransactionConfig = { ...config, gasPrice: gasPrice.toString(), nonce: nonce };
        cancelToken.check();    // don't send transaction if already canceled
        transactionLogger.info("SEND", { transactionId, resubmit: index, transaction: cfg });
        const promiEvent = settings.web3.eth.sendTransaction(cfg);
        promiEvent.catch(ignore);
        const finalizationCancelToken = new CancelToken();
        const finalizationPromise = waitForFinalization(transactionId, settings.web3, settings.waitFor, nonce, fromAddress, promiEvent, finalizationCancelToken);
        finalizationPromise.catch(ignore);
        try {
            const receipt = await waitForReceipt(promiEvent, cancelToken)
                .finally(() => {
                    // delay cancel to make sure we don't cancel a success because the replaced transaction failure triggers first
                    setTimeout(() => cancelToken.cancel(), 100);
                });
            transactionLogger.info("RECEIPT", { transactionId, resubmit: index, receipt });
            await finalizationPromise;
            return receipt;
        } finally {
            finalizationCancelToken.cancel();
        }
    });
    const results = await Promise.allSettled(resubmits);
    return extractActualResult(results);
}

const addressNonces = new Map<string, number>();

async function lockAddressNonce(settings: ContractSettings, address: string) {
    const start = new Date().getTime();
    while (new Date().getTime() - start < settings.nonceLockTimeoutMS) {
        const nonce = await settings.web3.eth.getTransactionCount(address, "latest");
        const lastNonce = addressNonces.get(address) ?? -1;
        if (nonce > lastNonce) {
            addressNonces.set(address, nonce);
            return nonce;
        }
        await sleep(100);
    }
    throw new Error("Timeout waiting to obtain address nonce lock");
}

function extractActualResult(results: PromiseSettledResult<TransactionReceipt>[]) {
    for (const result of results) {
        if (result.status === 'fulfilled') {
            return result.value;
        } else if (!(result.reason instanceof PromiseCancelled)) {
            throw result.reason;
        }
    }
    /* istanbul ignore next - this should never happen */
    throw new Error("All resubmits canceled");
}

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
            await waitForNonceIncrease(web3, from, initialNonce, waitFor.pollMS, cancelToken);
            transactionLogger.info("SUCCESS (nonce increase)", { transactionId });
        }
    }
    if (waitFor.timeoutMS) {
        await Promise.race([
            waitForFinalizationInner(),
            cancelableSleep(waitFor.timeoutMS, cancelToken).then(() => Promise.reject(new FinalizationTimeoutError("Timeout waiting for finalization"))),
        ]);
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
        const baseError = new Error("just for stack");
        promiEvent.on("error", (error) => reject(wrapTransactionError(error, baseError, 3))).catch(ignore);
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
        const baseError = new Error("just for stack");
        promiEvent.on("error", (error) => reject(wrapTransactionError(error, baseError, 3))).catch(ignore);
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
export async function waitForNonceIncrease(web3: Web3, address: string, initialNonce: number, pollMS: number, cancelToken: CancelToken): Promise<void> {
    for (let i = 0; ; i++) {
        const nonce = await web3.eth.getTransactionCount(address, "latest");
        cancelToken.check(); // prevent returning value if cancelled
        if (nonce > initialNonce) break;
        await cancelableSleep(pollMS, cancelToken);
    }
}

/* istanbul ignore next */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ignore(error: unknown) {
    // do nothing - the method can be used in promise `.catch()` to prevent
    // uncought error problems (when errors are properly caught elsewhere)
}
