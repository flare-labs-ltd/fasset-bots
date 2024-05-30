import { resolveFromPackageRoot, resolveInFassetBotsCore, squashSpace, stripIndent } from "@flarelabs/fasset-bots-core/utils";
import { Command } from "commander";
import fs from "fs";
import os from "os";
import path from "path";

type UserTypeForOptions = "agent" | "user" | "bot" | "util";

export function programWithCommonOptions(user: UserTypeForOptions, fassets: "single_fasset" | "all_fassets") {
    const configEnvVar = user === "user" ? "FASSET_USER_CONFIG" : "FASSET_BOT_CONFIG";
    const secretsEnvVar = user === "user" ? "FASSET_USER_SECRETS" : "FASSET_BOT_SECRETS";

    function createConfigOption() {
        return program
            .createOption(
                "-c, --config <configFile>",
                squashSpace`Config file path. If not provided, environment variable ${configEnvVar} is used as path, if set.
                        Default file is embedded in the program and usually works.`
            )
            .env(configEnvVar)
            .argParser((v) => expandConfigPath(v, user))
            .default(expandConfigPath("coston", user));
    }

    function createSecretsOption() {
        const allowDefaultSecrets = user === "user";
        const secretsOption = program
            .createOption(
                "-s, --secrets <secretsFile>",
                squashSpace`File containing the secrets (private keys / adresses, api keys, etc.). If not provided, environment variable ${secretsEnvVar}
                            is used as path, if set. ${allowDefaultSecrets ? "Default file is <USER_HOME>/fasset/secrets.json." : ""}`
            )
            .env(secretsEnvVar);
        if (allowDefaultSecrets) {
            return secretsOption.default(defaultSecretsPath());
        } else {
            return secretsOption.makeOptionMandatory();
        }
    }

    function createFAssetOption() {
        return program
            .createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query")
            .makeOptionMandatory();
    }

    function verifyFilesExist() {
        const options: { config: string; secrets: string; } = program.opts();
        // check config file
        if (!fs.existsSync(options.config)) {
            program.error(`Config file ${options.config} does not exist.`);
        }
        // check secrets file
        if (!fs.existsSync(options.secrets)) {
            const userOpts = { "agent": "--agent <management address>", "user": "--user", "bot": "--other", "util": "" };
            program.error(stripIndent`Secrets file ${options.secrets} does not exist. To create new secrets file, please execute
                                          yarn key-gen generateSecrets ${userOpts[user] ?? ""} -o "${options.secrets}"
                                      and edit the file as instructed by generateSecrets.`);
        }
    }

    const program = new Command();
    program.version(programVersion());
    program.addOption(createConfigOption());
    program.addOption(createSecretsOption());
    if (fassets === "single_fasset") {
        program.addOption(createFAssetOption());
    }
    program.hook("preAction", () => verifyFilesExist());
    return program;
}

// single word network name conversions, e.g. "coston" --> ".../fasset-bots-core/run-config/coston-bot.json"
export function expandConfigPath(config: string, user: UserTypeForOptions) {
    if (/^\w+$/.test(config)) {
        const suffix = user === "user" ? "user" : "bot";
        return resolveInFassetBotsCore(`run-config/${config}-${suffix}.json`);
    }
    return config;
}

let _programVersion: string | undefined;

export function programVersion() {
    if (_programVersion == undefined) {
        const mainFileDir = require.main?.filename ? path.dirname(require.main?.filename) : __dirname;
        const packageFile = resolveFromPackageRoot(mainFileDir, "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageFile).toString()) as { version?: string };
        _programVersion = packageJson.version ?? "---";
    }
    return _programVersion;
}

function defaultSecretsPath() {
    return path.resolve(os.homedir(), "fasset/secrets.json");
}
