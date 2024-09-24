import "dotenv/config";
import "source-map-support/register";

import {
    BotConfigFile, BotFAssetInfo, Secrets,
    loadConfigFile, loadConfigFileOrOverride, updateConfigFilePaths, BotConfigFileOverride,
} from "@flarelabs/fasset-bots-core/config";
import {
    assertCmd,
    CommandLineError
} from "@flarelabs/fasset-bots-core/utils";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import fs from "fs";

export type WalletApiType = "bitcore" | "blockbook";
const program = programWithCommonOptions("agent", "all_fassets");

program.name("api").description("Command line tool for adding fallback apis for FAssets");

program
    .command("add")
    .description("add fallback address for given FAsset / underlying")
    .argument("<token>", "token symbol")
    .argument("<type>", "blockchain API type (blockbook/bitcore)")
    .argument("<url>", "blockchain API url")
    .option("-k --key <key>", "blockchain API key")
    .action(async (tokenSymbol: string, type: WalletApiType, url: string, opts: { key?: string }) => {

        const { key } = opts;
        const options: { config: string; secrets: string, key: string } = program.opts();

        if (type !== "blockbook" && type !== "bitcore") {
            console.error(`Type should be 'bitcore' or 'blockbook'`);
            return;
        }

        const secrets = Secrets.load(options.secrets);
        const configFilePath = findConfigFileWithFAsset(tokenSymbol, options.config, new Set<string>());
        if (!configFilePath) {
            console.error(`Could not find token ${tokenSymbol} in config files`);
            return;
        }

        const botConfigFile = loadConfigFile(configFilePath);
        const token = findToken(botConfigFile, tokenSymbol);

        if (token.type !== "fasset" || !token.chainInfo) return;

        const api = {
            type: type,
            url: url,
        };
        if (!botConfigFile.fAssets[token.fassetSymbol].fallbackApis) {
            botConfigFile.fAssets[token.fassetSymbol].fallbackApis = [api];
        } else {
            botConfigFile.fAssets[token.fassetSymbol].fallbackApis?.push(api);
        }
        secrets.data.apiKey[`${token.chainInfo.tokenSymbol}_rpc_${getNewFallbackIndex(secrets, token.chainInfo)}`] = key ?? "";

        fs.writeFileSync(configFilePath, JSON.stringify(botConfigFile, null, 4));
        fs.writeFileSync(options.secrets, JSON.stringify(secrets.data, null, 4));

    });

toplevelRun(async () => {
    await program.parseAsync();
});

type TokenType =
    | { type: "fasset", fassetSymbol: string, chainInfo?: BotFAssetInfo }
    | { type: "underlying", chainInfo: BotFAssetInfo | undefined };

function findToken(config: BotConfigFile | BotConfigFileOverride, symbol: string): TokenType {
    symbol = symbol.toUpperCase();
    for (const [fassetSymbol, chainInfo] of Object.entries(config.fAssets ?? {})) {
        if (symbol === fassetSymbol.toUpperCase()) {
            return isBotFAssetInfo(chainInfo) ? { type: "fasset", fassetSymbol, chainInfo } : { type: "fasset", fassetSymbol};
        }
        if (symbol === chainInfo.tokenSymbol?.toUpperCase()) {
            return isBotFAssetInfo(chainInfo) ? { type: "fasset", fassetSymbol, chainInfo } : { type: "fasset", fassetSymbol};
        }
    }
    throw new CommandLineError(`Unknown token symbol ${symbol}`);
}

function getNewFallbackIndex(secrets: Secrets, chainInfo: BotFAssetInfo): number {
    const map = Object.keys(secrets.data.apiKey)
        .map(word => {
            const isMatch = new RegExp(`${chainInfo.tokenSymbol}_rpc_\\d+`).test(word);
            if (isMatch) {
                const numberMatch = word.match(/\d+/); // This captures the first number in the string
                return numberMatch ? parseInt(numberMatch[0], 10) : null; // Convert the captured number to an integer
            }
            return null;
        });

    const numbers = map
        .filter((num): num is number => num !== null);
    return numbers.length > 0 ? 1 + Math.max(...numbers) : 1;
}

function findConfigFileWithFAsset(tokenSymbol: string, fPath: string, visitedFiles: Set<string> = new Set()) {
    const config = loadConfigFileOrOverride(fPath);
    updateConfigFilePaths(fPath, config);

    try {
        findToken(config, tokenSymbol);
        return fPath;
    } catch (e) {
        if ("extends" in config) {
            visitedFiles.add(fPath);
            assertCmd(!visitedFiles.has(config.extends), `Circular config file dependency in ${config.extends}`);
            return findConfigFileWithFAsset(tokenSymbol, config.extends, visitedFiles);
        }
    }

    return undefined;
}

function isBotFAssetInfo(info: Partial<BotFAssetInfo>): info is BotFAssetInfo {
    const interfaceKeys = Object.keys(info) as Array<keyof BotFAssetInfo>;
    return interfaceKeys.every(key => key in info);
}