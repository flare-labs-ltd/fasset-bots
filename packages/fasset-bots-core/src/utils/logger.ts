import "dotenv/config";
import { AsyncLocalStorage } from "async_hooks";
import { createLogger, format } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { Console } from "winston/lib/winston/transports";
import * as Transport from "winston-transport";

export const loggerAsyncStorage = new AsyncLocalStorage<string>();

export type LoggerPaths = { text?: string, json?: string, logTarget?: string };

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
    if (paths.logTarget === 'console') {
        transports.push(...transports.map((transport) => new Console({ ...commonOptions, format: transport.format })));
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
const mainFileName = (require.main?.filename ?? "").replace(/\\/g, "/");
const fnMatch = mainFileName.match(/\/src\/(cli|run)\/([^/]+)\.(cjs|mjs|js|ts)$/);
const loggerName = fnMatch ? fnMatch[2] : "log";

export const logger = createCustomizedLogger({ json: `log/json/${loggerName}-%DATE%.log.json`, text: `log/text/${loggerName}-%DATE%.log`,
    logTarget: process.env.LOG_TARGET });
