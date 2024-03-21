export enum BotType {
    AGENT = "agent",
    LIQUIDATOR = "liquidator",
    CHALLENGER = "challenger"
}

export enum NotificationLevel {
    INFO = "info",
    DANGER = "danger",
    CRITICAL = "critical"
}

export interface NotifierTransport {
    send(type: BotType, address: string, level: NotificationLevel, title: string, message: string): Promise<void>;
}

export abstract class BaseNotifier<NOTIFICATION_KEY extends string> {
    constructor(
        public type: BotType,
        public address: string,
        public transports: NotifierTransport[],
    ) {}

    async send(level: NotificationLevel, title: NOTIFICATION_KEY, message: string) {
        for (const transport of this.transports) {
            await transport.send(this.type, this.address, level, title, message);
        }
    }

    async info(title: NOTIFICATION_KEY, message: string) {
        await this.send(NotificationLevel.INFO, title, message);
    }

    async danger(title: NOTIFICATION_KEY, message: string) {
        await this.send(NotificationLevel.DANGER, title, message);
    }

    async critical(title: NOTIFICATION_KEY, message: string) {
        await this.send(NotificationLevel.CRITICAL, title, message);
    }
}
