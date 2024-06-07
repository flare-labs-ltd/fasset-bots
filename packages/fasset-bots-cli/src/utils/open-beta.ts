import { ApiNotifierTransport } from "@flarelabs/fasset-bots-core";
import { Secrets } from "@flarelabs/fasset-bots-core/config";

export interface AgentRegistrationSubmission {
    management_address: string;
    tg_user_name: string;
    description: string;
    icon_url: string;
}

export class OpenBetaAgentRegistrationTransport extends ApiNotifierTransport {

    constructor(secrets: Secrets) {
        const apiUrl = secrets.required('openBeta.registrationApiUrl');
        const apiKey = secrets.required('openBeta.registrationApiKey');
        super(apiUrl, apiKey);
    }

    async getUnfundedAgents(): Promise<AgentRegistrationSubmission[]> {
        const resp = await this.client.get(`/registered_unfunded_users`);
        if (resp.status !== 200)
            throw Error(`Unable to fetch unfunded agents due to ${resp.statusText}`);
        return resp.data.data;
    }

    async confirmFundedAgent(managementAddress: string): Promise<void> {
        const resp = await this.client.post(`/confirm_funded`, {
            management_address: managementAddress
        });
        if (resp.status !== 200)
            throw Error(`Unable to confirm funded agent due to ${resp.statusText}`);
    }
}