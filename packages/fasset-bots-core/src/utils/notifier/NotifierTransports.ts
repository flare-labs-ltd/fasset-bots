import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import chalk from "chalk";
import { formatArgs } from "../formatting";
import { DEFAULT_TIMEOUT, systemTimestamp } from "../helpers";
import { logger } from "../logger";
import { BotType, NotificationLevel, NotifierTransport } from "./BaseNotifier";
import { createAxiosConfig } from "@flarelabs/simple-wallet";

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
type NotifierThrottlingConfig = { duration: number; addressInKey: boolean; };
export type NotifierThrottlingConfigs = { [notificationKey: string]: NotifierThrottlingConfig };

export class ThrottlingNotifierTransport implements NotifierTransport {
    static deepCopyWithObjectCreate = true;

    constructor(
        public wrappedTransport: NotifierTransport,
        public throttling: NotifierThrottlingConfigs,
    ) {}

    public lastAlertAt: { [notificationKey: string]: number } = {};

    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        const timestamp = systemTimestamp();
        const throttling = this.throttling[title];
        if (throttling) {
            const key = throttling.addressInKey ? `${title}-${address}` : title;
            const lastAlertAt = this.lastAlertAt[key] ?? 0;
            if (timestamp - lastAlertAt >= throttling.duration) {
                await this.wrappedTransport.send(type, address, level, title, message);
                this.lastAlertAt[key] = timestamp;
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
        this.client = axios.create(createAxiosConfig(alertsUrl, apiKey));
    }

    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        const request: PostAlert = {
            bot_type: type,
            address: address,
            level: level,
            title: title,
            description: message,
        };
        // run alert sending in the background
        void this.client.post(`/api/agent/botAlert`, request)
            .catch((e: AxiosError) => {
                const status = e.response?.status ?? "unknown status";
                const errorMessage = (e.response?.data as any)?.error ?? "unknown error";
                logger.error(`Notifier error: cannot send notification ${formatArgs(request)}: ${status}: ${errorMessage}`);
                console.error(`${chalk.red("Notifier error:")} cannot send notification (${request.level} to ${request.bot_type}) "${request.title}: ${request.description}"`)
            });
    }
}
