import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import chalk from "chalk";
import { formatArgs } from "../formatting";
import { DEFAULT_TIMEOUT } from "../helpers";
import { logger } from "../logger";
import { BotType, NotificationLevel, NotifierTransport } from "./BaseNotifier";

export function standardNotifierTransports(alertsUrl: string | undefined) {
    const transports: NotifierTransport[] = [];
    transports.push(new ConsoleNotifierTransport());
    transports.push(new LoggerNotifierTransport());
    if (alertsUrl) {
        transports.push(new ApiNotifierTransport(alertsUrl));
    }
    return transports;
}

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

interface PostAlert {
    bot_type: string; // agent, liquidator, challenger
    address: string;
    level: string; // info, danger, critical
    title: string;
    description: string;
}

export class ApiNotifierTransport implements NotifierTransport {
    static deepCopyWithObjectCreate = true;

    client: AxiosInstance;

    constructor(public alertsUrl: string) {
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: alertsUrl,
            timeout: DEFAULT_TIMEOUT,
            headers: {
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
        await this.client.post(`/api/0/bot_alert`, request)
            .catch((e: AxiosError) => {
                logger.error(`Notifier error: cannot send notification ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`);
                console.error(`${chalk.red("Notifier error:")} cannot send notification (${request.level} to ${request.bot_type}) "${request.title}: ${request.description}"`)
            });
    }
}
