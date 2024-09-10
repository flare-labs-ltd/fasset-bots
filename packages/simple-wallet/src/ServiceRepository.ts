import { IService } from "./interfaces/IService";

type Constructor<T> = new (...args: any[]) => T;

export class Repository {
    private services: Map<Constructor<any>, any> = new Map();

    register<T extends IService>(ServiceClass: Constructor<T>, instance: T): void {
        this.services.set(ServiceClass, instance);
    }

    get<T extends IService>(ServiceClass: Constructor<T>): T {
        const service = this.services.get(ServiceClass);
        if (!service) {
            throw new Error(`Service ${ServiceClass.name} not found`);
        }
        return service as T;
    }
}

export const ServiceRepository = new Repository();