import { TransactionConfig, TransactionReceipt } from "web3-core";
import { BN_ZERO, maxBN, sleep, toBN } from "../helpers";
import { CancelToken, PromiseCancelled, cancelableSleep } from "./cancelable-promises";
import { waitForFinalization, waitForReceipt } from "./finalization";
import { captureStackTrace, fixErrorStack, transactionLogger } from "./transaction-logging";
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
    await lockAddress(settings, fromAddress);
    transactionLogger.info("LOCK", { transactionId, fromAddress });
    try {
        return await performSubmits(transactionId, settings, config);
    } finally {
        transactionLogger.info("UNLOCK", { transactionId, fromAddress });
        await releaseAddress(fromAddress);
    }
}

const addressLocks = new Map<string, boolean>();

async function lockAddress(settings: ContractSettings, address: string) {
    const start = new Date().getTime();
    while (new Date().getTime() - start < settings.nonceLockTimeoutMS) {
        if (!addressLocks.get(address)) {
            addressLocks.set(address, true);
            return;
        }
        await sleep(100);
    }
    throw new Error("Timeout waiting to obtain address nonce lock");
}

async function releaseAddress(address: string) {
    addressLocks.delete(address);
}

async function performSubmits(transactionId: number, settings: ContractSettings, config: TransactionConfig) {
    const fromAddress = config.from as string;
    console.log(`Starting transaction submit (read nonce): address=${fromAddress} time=${new Date().toISOString()}`);
    const nonce = await settings.web3.eth.getTransactionCount(fromAddress, "latest");
    console.log(`Starting transaction submit: address=${fromAddress} nonce=${nonce} time=${new Date().toISOString()}`);
    transactionLogger.info("SUBMIT", { transactionId, waitFor: settings.waitFor, nonce });
    // resubmit transaction item with afterMS=0 is optional in settings - it can be added if you want the initial price factor to be different from 1
    let resubmitTransaction = settings.resubmitTransaction;
    if (resubmitTransaction.find((it) => it.afterMS === 0) == null) {
        resubmitTransaction = [{ afterMS: 0, priceFactor: 1 }, ...resubmitTransaction];
    }
    const cancelToken = new CancelToken();
    let currentGasPrice = BN_ZERO;
    const parentStack = captureStackTrace(2);
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
        const finalizationCancelToken = new CancelToken();
        const finalizationPromise = waitForFinalization(
            transactionId,
            settings.web3,
            settings.waitFor,
            nonce,
            fromAddress,
            promiEvent,
            finalizationCancelToken
        );
        finalizationPromise.catch(ignore);
        try {
            const receipt = await waitForReceipt(promiEvent, cancelToken).finally(() => {
                // delay cancel to make sure we don't cancel a success because the replaced transaction failure triggers first
                setTimeout(() => cancelToken.cancel(), 100);
            });
            transactionLogger.info("RECEIPT", { transactionId, resubmit: index, receipt });
            await finalizationPromise;
            return receipt;
        } catch (e) {
            throw fixErrorStack(e, parentStack);
        } finally {
            finalizationCancelToken.cancel();
        }
    });
    const results = await Promise.allSettled(resubmits);
    return extractActualResult(results);
}

function extractActualResult(results: PromiseSettledResult<TransactionReceipt>[]) {
    for (const result of results) {
        if (result.status === "fulfilled") {
            return result.value;
        } else if (!(result.reason instanceof PromiseCancelled)) {
            throw result.reason;
        }
    }
    /* istanbul ignore next - this should never happen */
    throw new Error("All resubmits canceled");
}

/* istanbul ignore next */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ignore(error: unknown) {
    // do nothing - the method can be used in promise `.catch()` to prevent
    // uncought error problems (when errors are properly caught elsewhere)
}
