import { createCustomizedLogger } from "../logger";

export const transactionLogger = createCustomizedLogger("log/transactions/transactions-%DATE%.log");

/* istanbul ignore next */
export function wrapTransactionError(transactionId: number, error: any) {
    const wrapped = new Error(String(error.message ?? error));
    const lines = (wrapped.stack ?? "")
        .replace(wrapped.message ?? "", "")
        .trim()
        .split("\n")
        .slice(2);
    const result = error instanceof Error ? error : wrapped;
    result.stack = `${error.stack}\n${lines.join("\n")}`;
    transactionLogger.info("ERROR", { transactionId, stack: result.stack });
    return result;
}
