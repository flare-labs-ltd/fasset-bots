import { HistoryItem } from "./historyItem";
import { MonitoringStateEntity } from "./monitoringState";
import { TransactionEntity } from "./transaction";
import { WalletAddressEntity } from "./wallet";

export * from "./wallet";
export * from "./transaction";
export * from "./monitoringState";
export * from "./historyItem";

export const simpleWalletEntities = [
    WalletAddressEntity,
    TransactionEntity,
    MonitoringStateEntity,
    HistoryItem
];
