import { EntityManager } from "@mikro-orm/core";
import BN from "bn.js";
import { transactional } from "../db/dbutils";
import { HistoryItem } from "../entity/historyItem";
import { logger } from "../utils/logger";
import { requireDefined } from "../utils/utils";

export const MAX_DB_HISTORY_BLOCKS = 1000;
export const DB_PRUNE_TIME = 3600 * 1000; // 1 hour

export interface BlockValue {
    blockHeight: number;
    value: BN;
}

export class BlockValueHistory {
    data: Map<number, BN> = new Map();
    lastDbPruneTimestamp = 0;

    constructor(
        public chainType: string,
        public dbKey: "averageFeePerKB" | "timestamp",
        public maxLength: number,
    ) {
    }

    sortedData(): BlockValue[] {
        const array = Array.from(this.data.entries(), ([blockHeight, value]) => ({ blockHeight, value }));
        array.sort((a, b) => a.blockHeight - b.blockHeight);
        return array;
    }

    pruneData() {
        const array = this.sortedData();
        for (let i = 0; i < array.length - this.maxLength; i++) {
            this.data.delete(array[i].blockHeight);
        }
    }

    consecutiveLength(untilBlockHeight: number): number {
        for (let i = 0; ; i++) {
            if (!this.data.has(untilBlockHeight - i)) {
                return i;
            }
        }
    }

    lastBlockHeight() {
        const blockHeights = Array.from(this.data.keys());
        return Math.max(0, ...blockHeights);
    }

    logHistory() {
        const consecutiveLength = this.consecutiveLength(this.lastBlockHeight());
        const lines: string[] = [];
        lines.push(`    Total history length for ${this.dbKey} for chain ${this.chainType} is ${this.data.size}, consecutive length is ${consecutiveLength}`);
        for (const block of this.sortedData()) {
            lines.push(`        height=${block.blockHeight}, ${this.dbKey}=${block.value}`);
        }
        return lines.join("\n");
    }

    async add(rootEm: EntityManager, blockHeight: number, value: BN) {
        if (this.data.has(blockHeight)) return;
        this.data.set(blockHeight, value);
        this.pruneData();
        await this.addToDb(rootEm, blockHeight, value);
        // auto prune db every hour
        if (Date.now() - this.lastDbPruneTimestamp >= DB_PRUNE_TIME) {
            await this.pruneDb(rootEm);
            this.lastDbPruneTimestamp = Date.now();
        }
    }

    async loadBlockFromService(rootEm: EntityManager, blockHeight: number, service: (blockHeight: number) => Promise<BN | null>) {
        if (this.data.has(blockHeight)) return;
        try {
            const value = await service(blockHeight);
            if (value == null) return;
            await this.add(rootEm, blockHeight, value);
        } catch (error) {
            console.error(`Error obtaining history value "${this.dbKey}" for chain ${this.chainType} and block height ${blockHeight}:`, error);
        }
    }

    async addToDb(rootEm: EntityManager, blockHeight: number, value: BN) {
        await transactional(rootEm, async (em) => {
            const ent = await em.findOne(HistoryItem, { chainType: this.chainType, blockHeight });
            if (ent != null) {
                if (ent[this.dbKey] != null) {
                    logger.warn(`History value "${this.dbKey}" for chain ${this.chainType} and block height ${blockHeight} already exists with value ${ent[this.dbKey]}; overwritten with ${value}`);
                }
                ent[this.dbKey] = value;
            } else {
                em.create(HistoryItem, {
                    chainType: this.chainType,
                    blockHeight: blockHeight,
                    [this.dbKey]: value,
                }, {
                    persist: true
                });
            }
        });
    }

    async pruneDb(rootEm: EntityManager, keepBlocks = MAX_DB_HISTORY_BLOCKS) {
        await transactional(rootEm, async (em) => {
            const count = await em.nativeDelete(HistoryItem, {
                chainType: this.chainType,
                blockHeight: { $lt: this.lastBlockHeight() - keepBlocks }
            });
            logger.info(`Pruned ${count} history blocks from db for ${this.dbKey} on chain ${this.chainType}`);
        });
    }

    async loadFromDb(em: EntityManager, length: number = this.maxLength) {
        const entities = await em.find(HistoryItem, {
            chainType: this.chainType,
            [this.dbKey]: { $ne: null }
        }, {
            orderBy: { blockHeight: "DESC" },
            limit: length,
        });
        for (const entity of entities) {
            if (!this.data.has(entity.blockHeight)) {
                this.data.set(entity.blockHeight, requireDefined(entity[this.dbKey]));
            }
        }
    }
}
