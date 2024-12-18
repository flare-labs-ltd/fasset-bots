import { PromiEvent, TransactionConfig, TransactionReceipt } from "web3-core";
import { BN_ZERO, errorIncluded, maxBN, toBN } from "../helpers";
import { CancelToken, PromiseCancelled, cancelableSleep } from "./cancelable-promises";
import { UnexpectedTransactionError, waitForFinalization, waitForReceipt } from "./finalization";
import { extractErrorMessage, transactionLogger } from "./transaction-logging";
import { ContractSettings } from "./types";

/**
 * Submit transactions and later resubmit with higher gas price if necessary.
 * Never executes new transaction from an address before the previous is mined or rejected (address is locked).
 * After receipt is obtained, wait for finalization.
 * @param transactionId numeric transaction id, to identify transaction for logging
 * @param settings mini truffle contract settings
 * @param config the transaction config to for `web3.eth.sendTransaction()`
 * @returns transaction receipt if successful
 */
export async function submitTransaction(transactionId: number, settings: ContractSettings, config: TransactionConfig) {
    const fromAddress = config.from as string;
    const lock = await settings.addressLocks.lock(fromAddress);
    transactionLogger.info("LOCK", { transactionId, fromAddress });
    try {
        return await performSubmits(transactionId, settings, config);
    } finally {
        transactionLogger.info("UNLOCK", { transactionId, fromAddress });
        await settings.addressLocks.release(lock);
    }
}

async function performSubmits(transactionId: number, settings: ContractSettings, config: TransactionConfig) {
    const fromAddress = config.from as string;
    const nonce = config.nonce ?? await settings.web3.eth.getTransactionCount(fromAddress, "latest");
    transactionLogger.info("SUBMIT", { transactionId, waitFor: settings.waitFor, nonce });
    // resubmit transaction item with afterMS=0 is optional in settings - it can be added if you want the initial price factor to be different from 1
    let resubmitTransaction = settings.resubmitTransaction;
    if (resubmitTransaction.find((it) => it.afterMS === 0) == null) {
        resubmitTransaction = [{ afterMS: 0, priceFactor: 1 }, ...resubmitTransaction];
    }
    const cancelToken = new CancelToken("resubmit");
    const waitReceiptCancelToken = new CancelToken("resubmit wait receipt");
    let currentGasPrice = BN_ZERO;
    const resubmits = resubmitTransaction.map(async (resubmit, index) => {
        if (resubmit.afterMS > 0) {
            await cancelableSleep(resubmit.afterMS, cancelToken);
        }
        // maxBN is here because currentGasPrice should increase with time so that each next submission has at least 10% higher price (of course, price factors must grow sufficiently)
        currentGasPrice = maxBN(currentGasPrice, toBN(config.gasPrice ?? (await settings.web3.eth.getGasPrice())));
        const gasPrice = currentGasPrice.muln(resubmit.priceFactor);
        const cfg: TransactionConfig = { ...config, gasPrice: gasPrice.toString(), nonce: nonce };
        cancelToken.check(); // don't send transaction if already canceled
        transactionLogger.info("SEND", { transactionId, resubmit: index, transaction: cfg });
        const promiEvent = settings.web3.eth.sendTransaction(cfg);
        promiEvent.catch(ignore);
        const finalizationCancelToken = new CancelToken("finalization");
        const finalizationPromise = waitForFinalization(transactionId, settings.web3, settings.waitFor, nonce, fromAddress, promiEvent, finalizationCancelToken);
        finalizationPromise.catch(ignore);
        try {
            const receipt = await waitForReceiptAndCancelOtherResubmits(promiEvent, waitReceiptCancelToken, cancelToken);
            transactionLogger.info("RECEIPT", { transactionId, resubmit: index, receipt });
            await finalizationPromise;
            return receipt;
        } catch (error) {
            transactionLogger.info("RESUBMIT ERROR", { transactionId, resubmit: index, errorMessage: extractErrorMessage(error) });
            throw error;
        } finally {
            finalizationCancelToken.cancel();
        }
    });
    const results = await Promise.allSettled(resubmits);
    return extractActualResult(results);
}

async function waitForReceiptAndCancelOtherResubmits(promiEvent: PromiEvent<TransactionReceipt>, waitReceiptCancelToken: CancelToken, cancelToken: CancelToken) {
    let cancelWaitReceiptTokenAfter: number = 0;
    try {
        const receipt = await waitForReceipt(promiEvent, waitReceiptCancelToken);
        // imediatelly cancel all other submitions on receipt
        cancelWaitReceiptTokenAfter = 0;
        return receipt;
    } catch (error) {
        // delay cancel by 5s when replacement or cancelation errors occur to make sure we don't cancel a success in another resubmit
        cancelWaitReceiptTokenAfter = resubmitErrorType(error) === "error" ? 0 : 5000;
        throw error;
    } finally {
        // immediately cancel not-yet-submitted transactions
        cancelToken.cancel();
        // cancel waitReceiptCancelToken after calculated timeout
        setTimeout(() => waitReceiptCancelToken.cancel(), cancelWaitReceiptTokenAfter);
    }
}

function resubmitErrorType(error: any) {
    if (error instanceof PromiseCancelled) {
        return "canceled"; // wait for submition or receipt canceled
    } else if (errorIncluded(error, [/nonce too low/i, "replacement transaction underpriced"])) {
        return "replaced"; // most likely some other resubmit was mined
    } else {
        return "error";    // any other error
    }
}

function extractActualResult(results: PromiseSettledResult<TransactionReceipt>[]) {
    for (const result of results) {
        if (result.status === "fulfilled") {
            return result.value;    // if there is any successful result, return it
        }
    }
    for (const result of results) {
        if (result.status === "rejected" && resubmitErrorType(result.reason) === "error") {
            throw result.reason;    // return first error that is neither cancel nor replacement
        }
    }
    for (const result of results) {
        if (result.status === "rejected" && resubmitErrorType(result.reason) === "replaced") {
            throw result.reason;    // any error except PromiseCancelled
        }
    }
    /* istanbul ignore next - this should never happen */
    throw new UnexpectedTransactionError("All resubmits canceled", null);
}

/* istanbul ignore next */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ignore(error: unknown) {
    // do nothing - the method can be used in promise `.catch()` to prevent
    // uncought error problems (when errors are properly caught elsewhere)
}
