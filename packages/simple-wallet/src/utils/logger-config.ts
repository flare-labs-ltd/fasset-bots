import { AsyncLocalStorage } from "async_hooks";
import { createLogger, format, type Logger } from "winston";
import { Console } from "winston/lib/winston/transports";
import DailyRotateFile from "winston-daily-rotate-file";
import * as Transport from "winston-transport";
import { redact } from "./secret-redact";


export const loggerAsyncStorage = new AsyncLocalStorage<string>();

export type LoggerPaths = { text?: string, json?: string, logTarget?: string };

function formatThreadId() {
    try {
        const threadName = loggerAsyncStorage.getStore();
        return threadName ? `[${threadName}]  ` : "";
    } catch (error) {
        console.error(error);
    }
}

export function createCustomizedLogger(paths: LoggerPaths): Logger {
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
                format.printf(info => JSON.stringify({
                    level: `${info.level}`,
                    message: `${info.message}`,
                    timestamp: `${info.timestamp}`,
                    stack: redact(`${info.stack}`)
                }))
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
                format.printf(info => `${info.timestamp}  ${formatThreadId()}${info.level.toUpperCase().padEnd(5)}  ${info.message}${redact(info.stack ? '\n' + info.stack : '')}`)
            ),
            filename: paths.text,
            ...(commonOptions as any),
        }));
    }
    if (paths.logTarget === 'console') {
        transports.push(...transports.map((transport) => new Console({ ...commonOptions, format: transport.format })));
    }
    return createLogger({ transports });
}