import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import chalk from "chalk";
import { formatArgs } from "../formatting";
import { DEFAULT_TIMEOUT, systemTimestamp } from "../helpers";
import { logger } from "../logger";
import { BotType, NotificationLevel, NotifierTransport } from "./BaseNotifier";

export class ConsoleNotifierTransport implements NotifierTransport {
    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        console.log(`${chalk.cyan(`${title}:`)} ${message}`);
    }
}

export class LoggerNotifierTransport implements NotifierTransport {
    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        if (level === NotificationLevel.INFO) {
            logger.info(`[ALERT:INFO] ${title}: ${message}`, { notification: { level, type, address } });
        } else if (level === NotificationLevel.DANGER) {
            logger.warn(`[ALERT:DANGER] ${title}: ${message}`, { notification: { level, type, address } });
        } else if (level === NotificationLevel.CRITICAL) {
            logger.error(`[ALERT:CRITICAL] ${title}: ${message}`, { notification: { level, type, address } });
        }
    }
}

// the time in seconds to throttle alert with title `notificationKey` (default no throttle)
export type NotifierThrottlingTimes = { [notificationKey: string]: number };

export class ThrottlingNotifierTransport implements NotifierTransport {
    static deepCopyWithObjectCreate = true;

    constructor(
        public wrappedTransport: NotifierTransport,
        public throttlingTimes: NotifierThrottlingTimes,
    ) {}

    public lastAlertAt: { [notificationKey: string]: number } = {};

    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        const timestamp = systemTimestamp();
        if (title in this.throttlingTimes) {
            const lastAlertAt = this.lastAlertAt[title] ?? 0;
            if (timestamp - lastAlertAt >= this.throttlingTimes[title]) {
                await this.wrappedTransport.send(type, address, level, title, message);
                this.lastAlertAt[title] = timestamp;
            }
        } else {
            // no throttling for this message type
            await this.wrappedTransport.send(type, address, level, title, message);
        }
    }
}

export interface PostAlert {
    bot_type: string; // agent, liquidator, challenger
    address: string;
    level: string; // info, danger, critical
    title: string;
    description: string;
}

export class ApiNotifierTransport implements NotifierTransport {
    static deepCopyWithObjectCreate = true;

    client: AxiosInstance;

    constructor(public alertsUrl: string, public apiKey: string) {
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: alertsUrl,
            timeout: DEFAULT_TIMEOUT,
            headers: {
                "X-API-KEY": apiKey,
                "Content-Type": "application/json",
            },
            validateStatus: function (status: number) {
                /* istanbul ignore next */
                return (status >= 200 && status < 300) || status == 500;
            },
        };
        // set client
        this.client = axios.create(createAxiosConfig);
    }

    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        const request: PostAlert = {
            bot_type: type,
            address: address,
            level: level,
            title: title,
            description: message,
        };
        await this.client.post(`/api/agent/botAlert`, request)
            .catch((e: AxiosError) => {
                logger.error(`Notifier error: cannot send notification ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`);
                console.error(`${chalk.red("Notifier error:")} cannot send notification (${request.level} to ${request.bot_type}) "${request.title}: ${request.description}"`)
            });
    }
}
