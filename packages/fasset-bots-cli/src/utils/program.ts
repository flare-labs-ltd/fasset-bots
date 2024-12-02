import { loadConfigFile } from "@flarelabs/fasset-bots-core/config";
import { programVersion, resolveInFassetBotsCore, stripIndent } from "@flarelabs/fasset-bots-core/utils";
import { Command } from "commander";
import fs from "fs";
import os from "os";
import path from "path";

type UserTypeForOptions = "agent" | "user" | "bot" | "util";

export function programWithCommonOptions(userType: UserTypeForOptions, fassets: "single_fasset" | "all_fassets") {
    const configEnvVar = chooseEnvVarByUserType("FASSET_USER_CONFIG", "FASSET_BOT_CONFIG");
    const secretsEnvVar = chooseEnvVarByUserType("FASSET_USER_SECRETS", "FASSET_BOT_SECRETS");

    // Return user env var if type is "user" and the user env var is defined. Otherwise fall back to bot env var.
    function chooseEnvVarByUserType(userEnvVar: string, botEnvVar: string) {
        if (userType === "user" && process.env[userEnvVar]) {
            return userEnvVar;
        } else {
            return botEnvVar;
        }
    }

    function createConfigOption() {
        const defaultPath = expandConfigPath("coston", userType);
        return program
            .createOption("-c, --config <configFile>",
                "config file path; you can also provide network name (e.g. 'coston'), in which case the appropriate config embedded in the program is used")
            .env(configEnvVar)
            .argParser((v) => expandConfigPath(v, userType))
            .default(defaultPath, `"${path.basename(defaultPath)}" (embedded in the program)`);
    }

    function createSecretsOption() {
        const allowDefaultSecrets = userType === "user";
        const secretsOption = program
            .createOption("-s, --secrets <secretsFile>", "file containing the secrets - private keys / adresses, api keys, etc.")
            .env(secretsEnvVar);
        if (allowDefaultSecrets) {
            return secretsOption.default(defaultSecretsPath());
        } else {
            return secretsOption.makeOptionMandatory();
        }
    }

    function createFAssetOption(mandatory: boolean = true) {
        const _program = program
            .createOption("-f, --fasset <fAssetSymbol>", `the symbol of the FAsset to mint, redeem or query`)
            .env("FASSET_DEFAULT")
        return mandatory ? _program.makeOptionMandatory() : _program;
    }

    function normalizeFAssetNameCase(configFName: string, fasset: string) {
        try {
            const configFile = loadConfigFile(configFName);
            for (const fassetKey of Object.keys(configFile.fAssets)) {
                if (fassetKey.toLowerCase() === fasset.toLowerCase()) {
                    return fassetKey;
                }
            }
        } catch (error) {
            // ignore errors loading config file - will be reported later
        }
        return fasset;
    }

    function verifyFilesExist() {
        const options: { config: string; secrets: string; fasset?: string; } = program.opts();
        // check config file
        if (!fs.existsSync(options.config)) {
            program.error(`Config file ${options.config} does not exist.`);
        }
        // check secrets file
        if (!fs.existsSync(options.secrets)) {
            const userOpts = { "agent": "--agent <management address>", "user": "--user", "bot": "--other", "util": "" };
            program.error(stripIndent`Secrets file ${options.secrets} does not exist. To create new secrets file, please execute
                                          yarn key-gen generateSecrets ${userOpts[userType] ?? ""} -o "${options.secrets}"
                                      and edit the file as instructed by generateSecrets.`);
        }
        // make -f option effectively case-insensitive
        if (options.fasset) {
            program.setOptionValue("fasset", normalizeFAssetNameCase(options.config, options.fasset));
        }
    }

    const program = new Command();
    program.version(programVersion());
    program.addOption(createConfigOption());
    program.addOption(createSecretsOption());
    program.addOption(createFAssetOption(fassets === "single_fasset"));
    program.hook("preAction", () => verifyFilesExist());
    return program;
}

// single word network name conversions, e.g. "coston" --> ".../fasset-bots-core/run-config/coston-bot.json"
export function expandConfigPath(config: string, user: UserTypeForOptions) {
    if (/^\w+$/.test(config)) {
        const suffix = user === "user" ? "user" : "bot";
        return resolveInFassetBotsCore(`run-config/${config}-${suffix}.json`);
    } else if (/^[\w-]+$/.test(config)) {
        return resolveInFassetBotsCore(`run-config/${config}.json`);
    }
    return config;
}

function defaultSecretsPath() {
    return path.resolve(os.homedir(), "fasset/secrets.json");
}

export function getOneDefaultToAll<T>(map: Map<string,T>, val?: string): T[] {
    if (val === undefined) {
        return Array.from(map.values());
    }
    const values = map.get(val);
    if (values === undefined) {
        throw new Error(`FAsset ${val} not found in config`);
    }
    return [values];
}
