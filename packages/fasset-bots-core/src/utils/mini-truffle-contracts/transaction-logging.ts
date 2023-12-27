import { createCustomizedLogger } from "../logger";

export const transactionLogger = createCustomizedLogger("log/transactions/transactions-%DATE%.log");

export function captureStackTrace(skipFrames: number = 0) {
    const error = new Error("just for stack");
    const skipLines = skipFrames + 2; // 1 line for message, 1 for captureStackTrace frame
    /* istanbul ignore next */
    return (error.stack ?? "").trim().split("\n").slice(skipLines).join("\n");
}

/* istanbul ignore next */
export function fixErrorStack(error: any, parentStackOrSkip: string | number) {
    const parentStack = typeof parentStackOrSkip === "string" ? parentStackOrSkip : captureStackTrace(parentStackOrSkip + 1); // 1 extra frame for fixErrorStack
    const result = error instanceof Error ? error : new Error(String(error.message ?? error));
    result.stack = `${error.stack ?? error.message ?? error}\n${parentStack}`;
    return result;
}
