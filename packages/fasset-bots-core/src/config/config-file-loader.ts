import "dotenv/config";

import path from "path";
import { CommandLineError, assertCmd, logger } from "../utils";
import { requireNotNull, substituteEnvVars } from "../utils/helpers";
import { resolveInFassetBotsCore } from "../utils/package-paths";
import { BotConfigFile, BotConfigFileOverride } from "./config-files/BotConfigFile";
import { loadContracts } from "./contracts";
import { IJsonLoader, JsonLoader } from "./json-loader";

const botConfigLoader: IJsonLoader<BotConfigFile> =
    new JsonLoader(resolveInFassetBotsCore("run-config/schema/bot-config.schema.json"), "bot config JSON");

const botConfigOverrideLoader: IJsonLoader<BotConfigFileOverride> =
    new JsonLoader(resolveInFassetBotsCore("run-config/schema/bot-config-override.schema.json"), "bot config JSON");

/**
 * Loads configuration file and checks it.
 * @param fPath configuration file path
 * @param configInfo
 * @returns instance BotConfigFile
 */
export function loadConfigFile(fPath: string, configInfo?: string): BotConfigFile {
    const config = loadConfigFileRecursive(fPath, configInfo);
    namespaceOrmPath(config);
    validateConfigFile(config);
    return config;
}

function loadConfigFileRecursive(fPath: string, configInfo?: string, visitedFiles: Set<string> = new Set()): BotConfigFile {
    const config = loadConfigFileOrOverride(fPath, configInfo);
    updateConfigFilePaths(fPath, config);
    if ("extends" in config) {
        visitedFiles.add(fPath);
        assertCmd(!visitedFiles.has(config.extends), `Circular config file dependency in ${config.extends}`);
        const base = loadConfigFileRecursive(config.extends, configInfo, visitedFiles);
        return mergeConfigFiles(base, fPath, config);
    } else {
        return config;  // not override
    }
}

function mergeConfigFiles(config: BotConfigFile, overrideFile: string, override: BotConfigFileOverride) {
    const result: any = { ...config };
    for (const [key, value] of Object.entries(override)) {
        if (key === "extends" || key === "fAssets") continue;
        result[key] = value;
    }
    result.ormOptions = { ...config.ormOptions, ...override.ormOptions };
    result.walletOptions = { ...config.walletOptions, ...override.walletOptions };
    result.nativeChainInfo = { ...config.nativeChainInfo, ...override.nativeChainInfo };
    result.fAssets = mergeFAssets(overrideFile, config.fAssets, override.fAssets);
    result.agentBotSettings = { ...config.agentBotSettings, ...override.agentBotSettings };
    result.agentBotSettings.fAssets = mergeFAssets(`${overrideFile} (agentBotSettings)`, config.agentBotSettings.fAssets, override.agentBotSettings?.fAssets);
    return result;
}

function mergeFAssets(overrideFile: string, configFAssets: Record<string, any>, overrideFAssets: Record<string, any> | undefined) {
    const resultFAssets: Record<string, any> = { ...configFAssets };
    for (const [symbol, info] of Object.entries(overrideFAssets ?? {})) {
        if (symbol in configFAssets) {
            resultFAssets[symbol] = { ...configFAssets[symbol], ...info };
        } else {
            console.warn(`Invalid fAsset symbol ${symbol} in config override file ${overrideFile}, ignored.`)
            logger.warn(`Invalid fAsset symbol ${symbol} in config override file ${overrideFile}, ignored.`)
        }
    }
    return resultFAssets;
}

export function loadConfigFileOrOverride(fPath: string, configInfo?: string): BotConfigFile | BotConfigFileOverride {
    try {
        const json = substituteEnvVars(JsonLoader.loadSimple(fPath));
        if ("extends" in (json as any)) {
            return botConfigOverrideLoader.validate(json, fPath);
        } else {
            return botConfigLoader.validate(json, fPath);
        }
    } catch (e) {
        logger.error(`${configInfo ?? ""} Error reading config file ${fPath}:`, e);
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

// resolve relative file paths
export function updateConfigFilePaths(cfPath: string, config: BotConfigFile | BotConfigFileOverride) {
    const cfDir = path.dirname(cfPath);
    if ("extends" in config) {
        config.extends = resolveExtendsPath(cfDir, config.extends);
    }
    if (config.contractsJsonFile) {
        config.contractsJsonFile = path.resolve(cfDir, config.contractsJsonFile);
    }
    // if (config.ormOptions?.type === "sqlite" && config.ormOptions.dbName) {
    //     config.ormOptions.dbName = path.resolve(cfDir, config.ormOptions.dbName);
    // }
}

function resolveExtendsPath(cfDir: string, extendsPath: string) {
    const isExplicitlyRelative = /^\.\.?[/\\]/.test(extendsPath);
    const basePath = isExplicitlyRelative ? cfDir : resolveInFassetBotsCore("run-config");
    return path.resolve(basePath, extendsPath);
}

function namespaceOrmPath(config: BotConfigFile) {
    // namespace SQLite db by asset manager controller address (only needed for beta testing)
    if (config.ormOptions?.type === "sqlite") {
        const contracts = config.contractsJsonFile ? loadContracts(config.contractsJsonFile) : null;
        const fullControllerAddress = config.assetManagerController ?? contracts?.AssetManagerController.address ?? "XXXXXXXXXX";
        const controllerAddress = fullControllerAddress.slice(2, 10);
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
    const config = loadConfigFile(fPath, configInfo);
    validateAgentConfigFile(config);
    return config;
}

/**
 * Validates agent configuration.
 * @param config instance BotConfigFile
 */
export function validateAgentConfigFile(config: BotConfigFile): void {
    validateConfigFile(config);
    if (config.dataAccessLayerUrls == null || config.dataAccessLayerUrls.length === 0) {
        throw new CommandLineError(`At least one attestation provider url is required`);
    }
    for (const [symbol, fc] of Object.entries(config.fAssets)) {
        if (fc.walletUrls == null || fc.walletUrls.length === 0) {
            throw new CommandLineError(`At least one walletUrl in FAsset type ${symbol} is required`);
        }
    }
}
