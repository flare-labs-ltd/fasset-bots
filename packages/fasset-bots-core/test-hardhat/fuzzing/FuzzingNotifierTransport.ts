import { BotType, NotificationLevel, NotifierTransport } from "../../src/utils/notifier/BaseNotifier";
import { EventFormatter } from "../test-utils/EventFormatter";

export class FuzzingNotifierTransport implements NotifierTransport {
    constructor(
        public eventFormatter: EventFormatter
    ) { }

    async send(type: BotType, address: string, level: NotificationLevel, title: string, message: string) {
        message = message.replace(/\b0x[0-9a-fA-F]{40}\b/g, (addr) => this.eventFormatter.formatAddress(addr));
        console.log(`ALERT:${level.toUpperCase()}[${type}:${this.eventFormatter.formatAddress(address)}] ${message}`);
    }
}
