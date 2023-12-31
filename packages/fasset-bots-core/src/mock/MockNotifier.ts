import { Notifier } from "../utils/Notifier";
import MockAdapter from "axios-mock-adapter";

export class MockNotifier extends Notifier {
    mock: MockAdapter | undefined;
    constructor() {
        super("Mock");
        if(this.client){
            this.mock = new MockAdapter(this.client);
            this.mock.onPost('/api/0/bot_alert').reply(config => {
                console.log('POST request made to /api/0/bot_alert', config.data);
                return [200, { data: 'Mocked data' }];
            });
        }
    }
}