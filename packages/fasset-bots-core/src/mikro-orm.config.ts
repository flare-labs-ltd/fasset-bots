import { Options } from "@mikro-orm/core";
import { AbstractSqlDriver } from "@mikro-orm/knex";
import { DatabaseAccount } from "./config/config-files/SecretsFile";
import { CreateOrmOptions, ORM, createOrm } from "./config/orm";
import { AgentEntity, AgentHandshake, AgentMinting, AgentRedemption, AgentUnderlyingPayment, AgentUpdateSetting, Event, RejectedRedemptionRequest, ReturnFromCoreVault, TransferToCoreVault } from "./entities/agent";
import { HistoryItem, MonitoringStateEntity, TransactionEntity, WalletAddressEntity } from "@flarelabs/simple-wallet";
import { ActivityTimestampEntity } from "./entities/activityTimestamp";

/* istanbul ignore next */
const options: Options<AbstractSqlDriver> = {
    entities: [WalletAddressEntity, AgentEntity, AgentMinting, AgentRedemption, Event, AgentUnderlyingPayment, AgentUpdateSetting,
        TransactionEntity, MonitoringStateEntity, HistoryItem, ActivityTimestampEntity, AgentHandshake, RejectedRedemptionRequest,
        ReturnFromCoreVault, TransferToCoreVault],
    dbName: "fasset-bots.db",
    debug: false,
};

export async function overrideAndCreateOrm(optionsOverride: CreateOrmOptions, databaseAccount: DatabaseAccount | undefined, defaultOptions: Options<AbstractSqlDriver> = options): Promise<ORM> {
    const createOptions: CreateOrmOptions = { ...defaultOptions, ...databaseAccount, ...optionsOverride };
    return createOrm(createOptions);
}

export default options;
