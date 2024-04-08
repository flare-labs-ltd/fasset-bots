import { resolveInFassetBotsCore, squashSpace } from "@flarelabs/fasset-bots-core/utils";
import { Command, Option } from "commander";
import fs from "fs";
import os from "os";
import path from "path";

export function programWithCommonOptions(user: "bot" | "user", fassets: "single_fasset" | "all_fassets") {
    const program = new Command();

    const configEnvVar = user === "user" ? "FASSET_USER_CONFIG" : "FASSET_BOT_CONFIG";
    const secretsEnvVar = user === "user" ? "FASSET_USER_SECRETS" : "FASSET_BOT_SECRETS";
    const allowDefaultSecrets = user === "user";

    program.addOption(
        program
            .createOption(
                "-c, --config <configFile>",
                squashSpace`Config file path. If not provided, environment variable ${configEnvVar} is used as path, if set.
                        Default file is embedded in the program and usually works.`
            )
            .env(configEnvVar)
            .default(resolveInFassetBotsCore("run-config/coston-user.json"))
    );
    program.addOption(
        setDynamicDefault(
            program
                .createOption(
                    "-s, --secrets <secretsFile>",
                    squashSpace`File containing the secrets (private keys / adresses, api keys, etc.). If not provided, environment variable ${secretsEnvVar}
                            is used as path, if set. ${allowDefaultSecrets ? "Default file is <USER_HOME>/.fasset/secrets.json." : ""}`
                )
                .env(secretsEnvVar),
            allowDefaultSecrets ? defaultSecretsPath() : undefined
        )
    );
    if (fassets === "single_fasset") {
        program.addOption(
            program
                .createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query")
                .makeOptionMandatory()
        );
    }

    return program;
}

function defaultSecretsPath() {
    const defaultSecretsPath = path.resolve(os.homedir(), "fasset/secrets.json");
    if (fs.existsSync(defaultSecretsPath)) {
        return defaultSecretsPath;
    }
}

function setDynamicDefault(option: Option, defaultValue: string | undefined) {
    return defaultValue != undefined ? option.default(defaultValue) : option.makeOptionMandatory();
}
