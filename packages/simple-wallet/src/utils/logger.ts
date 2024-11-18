import { AsyncLocalStorage } from "async_hooks";
import { createLogger, format } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import * as Transport from "winston-transport";

export const loggerAsyncStorage = new AsyncLocalStorage<string>();

export type LoggerPaths = { text?: string, json?: string };

export function createCustomizedLogger(paths: LoggerPaths) {
    const transports: Transport[] = [];
    const commonOptions: DailyRotateFile.DailyRotateFileTransportOptions = {
        level: "info",
        datePattern: "YYYY-MM-DD",
        zippedArchive: true,
        maxSize: "50m",
        maxFiles: "14d",
    };
    if (paths.json) {
        transports.push(new DailyRotateFile({
            format: format.combine(
                format.timestamp(),
                format.errors({ stack: true }),
                format.json()
            ),
            filename: paths.json,
            json: true,
            ...(commonOptions as any),
        }));
    }
    if (paths.text) {
        transports.push(new DailyRotateFile({
            format: format.combine(
                format.timestamp(),
                format.errors({ stack: true }),
                format.printf(info => `${info.timestamp}  ${formatThreadId()}${info.level.toUpperCase().padEnd(5)}  ${info.message}${info.stack ? '\n' + info.stack : ''}`)
            ),
            filename: paths.text,
            ...(commonOptions as any),
        }));
    }
    return createLogger({ transports });
}

function formatThreadId() {
    try {
        const threadName = loggerAsyncStorage.getStore();
        return threadName ? `[${threadName}]  ` : "";
    } catch (error) {
        console.error(error);
    }
}

// use different
const loggerName = "simple-wallet";

export const logger = createCustomizedLogger({ json: `log/json/${loggerName}-%DATE%.log.json`, text: `log/text/${loggerName}-%DATE%.log` });
