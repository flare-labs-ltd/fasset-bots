import "dotenv/config";
import { createCustomizedLogger } from "@flarelabs/simple-wallet";
import type { Logger } from "winston";


const mainFileName = (require.main?.filename ?? "").replace(/\\/g, "/");
const fnMatch = mainFileName.match(/\/src\/(cli|run)\/([^/]+)\.(cjs|mjs|js|ts)$/);
const loggerName = fnMatch ? fnMatch[2] : "log";

export const logger: Logger = createCustomizedLogger({
    json: `log/json/${loggerName}-%DATE%.log.json`,
    text: `log/text/${loggerName}-%DATE%.log`,
    logTarget: process.env.LOG_TARGET
});
