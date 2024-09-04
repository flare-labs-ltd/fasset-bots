import { logger } from "../utils/logger";
import { errorMessage } from "../chain-clients/utils";

export async function tryWithClients<T>(clients: any, operation: (client: any) => Promise<T>, method: string) {
    for (const [index, url] of Object.keys(clients).entries()) {
        try {
            const result = await operation(clients[url]);
            return result;
        } catch (error) {
            if (index == Object.keys(clients).length - 1) {
                throw error;
            }
            logger.warn(`Client ${url} - ${method} failed with: ${errorMessage(error)}`);
        }
    }
    throw new Error(`All blockchain clients failed.`);
}