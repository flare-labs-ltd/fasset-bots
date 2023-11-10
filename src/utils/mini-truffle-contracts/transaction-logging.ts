import { createCustomizedLogger } from "../logger";

export const transactionLogger = createCustomizedLogger("log/transactions/transactions-%DATE%.log");

/* istanbul ignore next */
export function wrapTransactionError(error: any, baseError?: Error | null, skipLines: number = 1) {
    const stackError = baseError ?? new Error("just for stack");
    const stackLines = (stackError.stack ?? "").replace(stackError.message, "").trim().split("\n").slice(skipLines);
    const result = error instanceof Error ? error : new Error(String(error.message ?? error));
    result.stack = `${error.stack ?? error.message ?? error}\n${stackLines.join("\n")}`;
    return result;
}
