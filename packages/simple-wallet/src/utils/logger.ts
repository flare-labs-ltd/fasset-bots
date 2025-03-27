import "dotenv/config";
import { createCustomizedLogger } from "./logger-config";


const loggerName = "simple-wallet";

export const logger = createCustomizedLogger({
    json: `log/json/${loggerName}-%DATE%.log.json`,
    text: `log/text/${loggerName}-%DATE%.log`,
    logTarget: process.env.SEND_LOGS_TO
});
