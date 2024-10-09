import { ChainType } from "./utils/constants";

type Constructor<T> = new (...args: any[]) => T;

export class Repository {
    private services = new Map<ChainType, Map<Constructor<unknown>, unknown>>();

    register<T>(chainType: ChainType, ServiceClass: Constructor<T>, instance: T): void {
        if (!this.services.has(chainType)) {
            this.services.set(chainType, new Map<Constructor<T>, T>());
        }
        this.services.get(chainType)!.set(ServiceClass, instance);
    }

    get<T>(chainType: ChainType, ServiceClass: Constructor<T>): T {
        const chainServiceMap = this.services.get(chainType);
        if (!chainServiceMap) {
            throw new Error(`No service registered for ${chainType}`);
        }

        const service = chainServiceMap.get(ServiceClass) as T;
        if (!service) {
            throw new Error(`Service ${ServiceClass.name} not found`);
        }

        return service;
    }
}

export const ServiceRepository = new Repository();