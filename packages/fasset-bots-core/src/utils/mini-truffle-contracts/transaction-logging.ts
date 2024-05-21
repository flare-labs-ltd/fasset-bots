import { createCustomizedLogger } from "../logger";

export const transactionLogger = createCustomizedLogger({ json: "log/transactions/transactions-%DATE%.log.json" });

export class ErrorWithCause extends Error {
    #errorCause: any;

    constructor(
        message: string,
        errorCause: any,
    ) {
        super(message);
        this.#errorCause = errorCause;
    }

    get errorCause() {
        return this.#errorCause;
    }

    fullStack() {
        function formatStack(error: any) {
            const stack = error.stack;
            /* istanbul ignore next */
            return stack ? stack.replace(/^Error:/, `${error.constructor?.name ?? "Error"}:`) : String(error);
        }
        const parts: string[] = [formatStack(this)];
        let error = this.errorCause;
        for (let i = 0; i < 10 && error != null; i++) {
            parts.push("  caused by: " + formatStack(error));
            error = error.errorCause;
        }
        return parts.join("\n");
    }
}

// Return first line of the error message
export function extractErrorMessage(error: any, defaultMsg: string = "Unknown error") {
    /* istanbul ignore next */
    return error?.message?.split("\n")[0] ?? defaultMsg;
}
