import Web3 from "web3";
import { CancelToken, CancelTokenRegistration, cancelableSleep } from "./cancelable-promises";
import { TransactionWaitFor } from "./types";

export async function waitForFinalization(web3: Web3, waitFor: TransactionWaitFor, initialNonce: number, from: string, promiEvent: PromiEvent<TransactionReceipt>): Promise<TransactionReceipt> {
    async function waitForFinalizationInner(): Promise<TransactionReceipt> {
        if (waitFor.what === 'receipt') {
            return await waitForReceipt(promiEvent, cancelToken);
        } else if (waitFor.what === 'confirmations') {
            return await waitForConfirmations(promiEvent, waitFor.confirmations, cancelToken);
        } else /* waitFor.what === 'nonceIncrease' */ {
            const receipt = await waitForReceipt(promiEvent, cancelToken);
            await waitForNonceIncrease(web3, from, initialNonce, waitFor.pollMS, cancelToken);
            return receipt;
        }
    }

    const cancelToken = new CancelToken();
    try {
        if (waitFor.timeoutMS) {
            const result = await Promise.race([
                waitForFinalizationInner(),
                cancelableSleep(waitFor.timeoutMS, cancelToken).then(() => Promise.reject(new Error("Timeout waiting for finalization")))
            ]);
            return result;
        } else {
            return await waitForFinalizationInner();
        }
    } finally {
        cancelToken.cancel();
    }
}

// just like `await promiEvent`, except that this is cancelable
export function waitForReceipt(promiEvent: PromiEvent<TransactionReceipt>, cancelToken: CancelToken): Promise<TransactionReceipt> {
    let cancelRegistration: CancelTokenRegistration;
    return new Promise<TransactionReceipt>((resolve, reject) => {
        promiEvent.on('receipt', (receipt) => resolve(receipt)).catch(ignore);
        promiEvent.on('error', (error) => reject(error)).catch(ignore);
        cancelRegistration = cancelToken.register(reject);
    }).finally(() => {
        cancelRegistration.unregister();
        (promiEvent as any).off('receipt');
        (promiEvent as any).off('error');
    });
}

export function waitForConfirmations(promiEvent: PromiEvent<any>, confirmationsRequired: number, cancelToken: CancelToken): Promise<TransactionReceipt> {
    let cancelRegistration: CancelTokenRegistration;
    return new Promise<TransactionReceipt>((resolve, reject) => {
        promiEvent.on("confirmation", (confirmations, receipt) => {
            console.log("Confirmation", confirmations);
            if (confirmations >= confirmationsRequired) {
                resolve(receipt);
            }
        }).catch(ignore);
        promiEvent.on('error', (error) => reject(error)).catch(ignore);
        cancelRegistration = cancelToken.register(reject);
    }).finally(() => {
        cancelRegistration.unregister();
        (promiEvent as any).off('confirmation');
        (promiEvent as any).off('error');
    });
}

export async function waitForNonceIncrease(web3: Web3, address: string, initialNonce: number, pollMS: number, cancelToken: CancelToken): Promise<void> {
    for (let i = 0; ; i++) {
        const nonce = await web3.eth.getTransactionCount(address, 'latest');
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
