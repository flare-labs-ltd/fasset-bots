import { ApiNotifierTransport } from "@flarelabs/fasset-bots-core";
import { Secrets } from "@flarelabs/fasset-bots-core/config";

export interface AgentRegistrationSubmission {
    management_address: string;
    agent_name: string;
    description: string;
    icon_url: string;
}

export class OpenBetaAgentRegistrationTransport extends ApiNotifierTransport {

    constructor(secrets: Secrets) {
        const apiUrl = secrets.required('openBeta.registrationApiUrl');
        const apiKey = secrets.required('openBeta.registrationApiKey');
        super(apiUrl, apiKey);
    }

    async unfinalizedRegistrations(): Promise<AgentRegistrationSubmission[]> {
        const resp = await this.client.get(`/approved_unregistered`);
        if (resp.status !== 200)
            throw Error(`Unable to fetch unfunded agents due to ${resp.statusText}`);
        return resp.data.data;
    }

    async finalizeRegistration(managementAddress: string): Promise<void> {
        const resp = await this.client.post(`/finalize_registration`, {
            management_address: managementAddress
        });
        if (resp.status !== 200)
            throw Error(`Unable to confirm funded agent due to ${resp.statusText}`);
    }
}