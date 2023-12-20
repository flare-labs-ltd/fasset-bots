import { createLogger, format } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

export function createCustomizedLogger(path: string) {
    const transport = new DailyRotateFile({
        filename: path,
        datePattern: "YYYY-MM-DD",
        zippedArchive: true,
        maxSize: "50m",
        maxFiles: "14d",
        json: true,
    });

    const logger = createLogger({
        format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
        level: "info",
        transports: transport,
    });

    return logger;
}

export const logger = createCustomizedLogger("log/log-%DATE%.log");
