import { createLogger, format } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const transport: DailyRotateFile = new DailyRotateFile({
    filename: "log/log-%DATE%.log",
    datePattern: "YYYY-MM-DD",
    zippedArchive: true,
    maxSize: "50m",
    maxFiles: "14d",
    json: true,
});

export const logger = createLogger({
    format: format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
    level: "info",
    transports: transport,
});
