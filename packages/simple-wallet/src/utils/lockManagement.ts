import { EntityManager } from "@mikro-orm/core";
import { MonitoringStateEntity } from "../entity/monitoring_state";
import { ChainType } from "./constants";
import { FilterQuery } from "@mikro-orm/core";

const chainTypeLocks = new Map<ChainType, boolean>();

export function lockChainType(chainType: ChainType): void {
    chainTypeLocks.set(chainType, true);
}

export function unlockChainType(chainType: ChainType): void {
    chainTypeLocks.delete(chainType);
}

export async function fetchMonitoringState(rootEm: EntityManager, chainType: string): Promise<MonitoringStateEntity | null> {
    return await rootEm.findOne(MonitoringStateEntity, { chainType } as FilterQuery<MonitoringStateEntity>, { refresh: true });
}


export async function updateMonitoringState(rootEm: EntityManager, chainType: string, modify: (stateEnt: MonitoringStateEntity) => Promise<void>): Promise<void> {
    await rootEm.transactional(async (em) => {
        const stateEnt = await fetchMonitoringState(rootEm, chainType);
        if (!stateEnt) return;
        await modify(stateEnt);
        await em.persistAndFlush(stateEnt);
    });
}