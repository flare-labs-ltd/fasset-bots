import { createCustomizedLogger } from "../logger";

export const transactionLogger = createCustomizedLogger("log/transactions/transactions-%DATE%.log");

export function wrapTransactionError(transactionId: number, error: any): never {
    /* istanbul ignore next */
    const wrapped = new Error(String(error.message ?? error));
    /* istanbul ignore next */
    const lines = (wrapped.stack ?? '').replace(wrapped.message ?? '', '').trim().split('\n').slice(2);
    wrapped.stack = `${error.stack}\n${lines.join('\n')}`;
    transactionLogger.info("ERROR", { transactionId, stack: wrapped.stack });
    throw wrapped;
}
