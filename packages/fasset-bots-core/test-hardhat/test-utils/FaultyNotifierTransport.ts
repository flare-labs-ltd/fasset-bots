import MockAdapter from "axios-mock-adapter";
import { ApiNotifierTransport } from "../../src/utils/notifier/NotifierTransports";

// to use in tests
export class FaultyNotifierTransport extends ApiNotifierTransport {
    mock: MockAdapter | undefined;

    constructor() {
        super("FaultyNotifier");
        if (this.mock) {
            this.mock.onPost("/api/0/bot_alert").reply(500, "Internal Server Error");
        }
    }
}
