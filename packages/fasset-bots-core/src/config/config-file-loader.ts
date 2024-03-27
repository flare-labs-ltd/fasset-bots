import "dotenv/config";

import path from "path";
import { getSecrets } from ".";
import { logger } from "../utils";
import { requireNotNull } from "../utils/helpers";
import { resolveInFassetBotsCore } from "../utils/package-paths";
import { BotConfigFile, BotFAssetInfo } from "./config-files/BotConfigFile";
import { loadContracts } from "./contracts";
import { IJsonLoader, JsonLoader } from "./json-loader";
import { CreateOrmOptions } from "./orm";


export const botConfigLoader: IJsonLoader<BotConfigFile> =
    new JsonLoader(resolveInFassetBotsCore("run-config/schema/bot-config.schema.json"), "bot config JSON");

/**
 * Loads configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance BotConfigFile
 */
export function loadConfigFile(fPath: string, configInfo?: string, validate: boolean = true): BotConfigFile {
    try {
        const config = botConfigLoader.load(fPath);
        updateConfigFilePaths(fPath, config);
        if (validate) {
            validateConfigFile(config);
            // check secrets.json file permission
            getSecrets();
        }
        return config;
    } /* istanbul ignore next */ catch (e) {
        logger.error(configInfo ?? "", e);
        throw e;
    }
}

/**
 * Validates configuration.
 * @param config instance of interface BotConfigFile
 */

export function validateConfigFile(config: BotConfigFile): void {
    if (config.addressUpdater == null && config.contractsJsonFile == null) {
        throw new Error("Missing either contractsJsonFile or addressUpdater in config");
    }
    for (const fc of config.fAssetInfos) {
        if (fc.assetManager == null && fc.fAssetSymbol == null) {
            throw new Error(`Missing either assetManager or fAssetSymbol in FAsset type ${fc.fAssetSymbol}`);
        }
    }
}

export function updateConfigFilePaths(cfPath: string, config: BotConfigFile) {
    const cfDir = path.dirname(cfPath);
    if (config.contractsJsonFile) {
        config.contractsJsonFile = path.resolve(cfDir, config.contractsJsonFile);
    }
    // namespace SQLite db by asset manager controller address (only needed for beta testing)
    if (config.ormOptions?.type === "sqlite" && config.contractsJsonFile) {
        const contracts = loadContracts(config.contractsJsonFile);
        const controllerAddress = contracts.AssetManagerController.address.slice(2, 10);
        config.ormOptions.dbName = requireNotNull(config.ormOptions.dbName).replace(/CONTROLLER/g, controllerAddress);
    }
}

export type AgentBotFAssetInfo = BotFAssetInfo & { walletUrl: string; };
export type AgentBotConfigFile = BotConfigFile & { ormOptions: CreateOrmOptions; fAssetInfos: AgentBotFAssetInfo[]; };

/**
 * Loads agent configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance AgentBotConfigFile
 */
export function loadAgentConfigFile(fPath: string, configInfo?: string): AgentBotConfigFile {
    try {
        const config = botConfigLoader.load(fPath);
        updateConfigFilePaths(fPath, config);
        validateAgentConfigFile(config);
        // check secrets.json file permission
        getSecrets();
        return config as AgentBotConfigFile;
    } /* istanbul ignore next */ catch (e) {
        logger.error(configInfo ?? "", e);
        throw e;
    }
}

/**
 * Validates agent configuration.
 * @param config instance BotConfigFile
 */
function validateAgentConfigFile(config: BotConfigFile): void {
    validateConfigFile(config);
    for (const fc of config.fAssetInfos) {
        if (fc.walletUrl == null) {
            throw new Error(`Missing walletUrl in FAsset type ${fc.fAssetSymbol}`);
        }
    }
}
