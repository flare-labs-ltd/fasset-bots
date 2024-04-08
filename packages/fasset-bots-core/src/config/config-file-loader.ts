import "dotenv/config";

import path from "path";
import { CommandLineError, logger } from "../utils";
import { requireNotNull } from "../utils/helpers";
import { resolveInFassetBotsCore } from "../utils/package-paths";
import { BotConfigFile } from "./config-files/BotConfigFile";
import { loadContracts } from "./contracts";
import { IJsonLoader, JsonLoader } from "./json-loader";


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
    if (config.assetManagerController == null && config.contractsJsonFile == null) {
        throw new CommandLineError("At least one of contractsJsonFile or assetManagerController must be defined");
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
        config.ormOptions.dbName = requireNotNull(process.env.FASSET_BOT_SQLITE_DB ?? config.ormOptions.dbName).replace(/CONTROLLER/g, controllerAddress);
    }
}

/**
 * Loads agent configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance AgentBotConfigFile
 */
export function loadAgentConfigFile(fPath: string, configInfo?: string): BotConfigFile {
    try {
        const config = botConfigLoader.load(fPath);
        updateConfigFilePaths(fPath, config);
        validateAgentConfigFile(config);
        return config;
    } /* istanbul ignore next */ catch (e) {
        logger.error(configInfo ?? "", e);
        throw e;
    }
}

/**
 * Validates agent configuration.
 * @param config instance BotConfigFile
 */
export function validateAgentConfigFile(config: BotConfigFile): void {
    validateConfigFile(config);
    if (config.attestationProviderUrls == null || config.attestationProviderUrls.length === 0) {
        throw new CommandLineError(`At least one attestation provider url is required`);
    }
    for (const [symbol, fc] of Object.entries(config.fAssets)) {
        if (fc.walletUrl == null) {
            throw new CommandLineError(`Missing walletUrl in FAsset type ${symbol}`);
        }
    }
}
