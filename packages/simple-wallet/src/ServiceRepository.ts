import { IService } from "./interfaces/IService";
import { ChainType } from "./utils/constants";

type Constructor<T> = new (...args: any[]) => T;

export class Repository {
    private services: Map<ChainType, Map<Constructor<any>, any>> = new Map();

    register<T extends IService>(chainType: ChainType, ServiceClass: Constructor<T>, instance: T): void {
        if (!this.services.has(chainType)) {
            this.services.set(chainType, new Map());
        }
        this.services.get(chainType)!.set(ServiceClass, instance);
    }

    get<T extends IService>(chainType: ChainType, ServiceClass: Constructor<T>): T {
        const chainServiceMap = this.services.get(chainType);
        if (!chainServiceMap) {
            throw new Error(`No service registered for ${chainType}`);
        }

        const service = chainServiceMap.get(ServiceClass);
        if (!service) {
            throw new Error(`Service ${ServiceClass.name} not found`);
        }

        return service as T;
    }
}

export const ServiceRepository = new Repository();