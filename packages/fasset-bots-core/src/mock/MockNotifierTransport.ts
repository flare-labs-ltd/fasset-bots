import MockAdapter from "axios-mock-adapter";
import { ApiNotifierTransport } from "../utils/notifier/NotifierTransports";
import { NotificationLevel } from "../utils/notifier/BaseNotifier";

export class MockNotifierTransport extends ApiNotifierTransport {
    mock: MockAdapter | undefined;

    constructor() {
        super({
            apiUrl: "Mock",
            apiKey: "MockApiKey",
            level: NotificationLevel.INFO
        });
        this.mock = new MockAdapter(this.client);
        this.mock.onPost('/api/0/bot_alert').reply(config => {
            console.log('POST request made to /api/0/bot_alert', config.data);
            return [200, { data: 'Mocked data' }];
        });
    }
}
