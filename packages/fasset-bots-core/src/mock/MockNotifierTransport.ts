import MockAdapter from "axios-mock-adapter";
import { ApiNotifierTransport } from "../utils/notifier/NotifierTransports";

export class MockNotifierTransport extends ApiNotifierTransport {
    mock: MockAdapter | undefined;

    constructor() {
        super("Mock");
        this.mock = new MockAdapter(this.client);
        this.mock.onPost('/api/0/bot_alert').reply(config => {
            console.log('POST request made to /api/0/bot_alert', config.data);
            return [200, { data: 'Mocked data' }];
        });
    }
}
