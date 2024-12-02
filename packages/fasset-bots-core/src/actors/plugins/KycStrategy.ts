import axios from "axios"
import { DEFAULT_TIMEOUT } from "../../utils"
import type { AxiosInstance, AxiosRequestConfig } from "axios";


export interface KycClient {
    isSanctioned(address: string, chain: string): Promise<boolean>
}

export class ChainalysisClient implements KycClient {
    client: AxiosInstance;

    constructor(public url: string, public apiKey: string) {
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: url,
            timeout: DEFAULT_TIMEOUT,
            headers: {
                "Token": apiKey,
                "Content-Type": "application/json",
            },
            validateStatus: function (status: number) {
                /* istanbul ignore next */
                return (status >= 200 && status < 300) || status == 500 || status == 404;
            },
        };
        // set client
        this.client = axios.create(createAxiosConfig);
    }

    async isSanctioned(address: string, chain: string): Promise<boolean> {
        const resp = await this.client.get(address)
        if (resp.status === 200 && resp.data != null && resp?.data?.error == null) {
            return resp.data.risk !== 'Low'
        } else if (resp?.data?.error == 'Not Found') {
            return false
        }
        return true
    }
}