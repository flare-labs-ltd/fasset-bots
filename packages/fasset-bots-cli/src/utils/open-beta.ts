import { ApiNotifierTransport } from "@flarelabs/fasset-bots-core";
import { Secrets } from "@flarelabs/fasset-bots-core/config";

export interface AgentRegistrationSubmission {
    management_address: string;
    agent_name: string;
    description: string;
    icon_url: string;
    user_address?: string;
}

export class AgentRegistrationTransport extends ApiNotifierTransport {

    constructor(secrets: Secrets, beta: "open" | "closed") {
        const secretsKey = beta === "open" ? 'openBeta' : 'closedBeta';
        const apiUrl = secrets.required(`${secretsKey}.registrationApiUrl`);
        const apiKey = secrets.required(`${secretsKey}.registrationApiKey`);
        super(apiUrl, apiKey);
    }

    async awaitingFinalization(): Promise<AgentRegistrationSubmission[]> {
        return this.submissions(1);
    }

    async finalizedRegistrations(): Promise<AgentRegistrationSubmission[]> {
        return this.submissions(2);
    }

    async submissions(status: number): Promise<AgentRegistrationSubmission[]> {
        const resp = await this.client.get(`/submission`, { params: { status } });
        if (resp.status !== 200)
            throw Error(`Unable to fetch submissions due to ${resp.statusText}`);
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