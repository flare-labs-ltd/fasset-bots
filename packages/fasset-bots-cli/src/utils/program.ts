import { resetSecrets } from "@flarelabs/fasset-bots-core/config";
import { CommandLineError, resolveInFassetBotsCore, squashSpace } from "@flarelabs/fasset-bots-core/utils";
import { Command } from "commander";
import fs from "fs";
import os from "os";
import path from "path";

export function programWithCommonOptions(user: 'bot' | 'user', fassets: 'single_fasset' | 'all_fassets') {
    const program = new Command();

    const configEnvVar = user === 'user' ? "FASSET_USER_CONFIG" : "FASSET_BOT_CONFIG";
    const secretsEnvVar = user === 'user' ? "FASSET_USER_SECRETS" : "FASSET_BOT_SECRETS";
    const allowDefaultSecrets = user === 'user';

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
        program
            .createOption(
                "-s, --secrets <secretsFile>",
                `File containing the secrets (private keys / adresses, api keys, etc.). If not provided, environment variable ${secretsEnvVar}
                        is used as path, if set. ${allowDefaultSecrets ? "Default file is <USER_HOME>/.fasset/secrets.json." : ""}`
            )
            .env(secretsEnvVar)
            .makeOptionMandatory()
    );
    if (fassets === 'single_fasset') {
        program.addOption(
            program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query")
                .makeOptionMandatory()
        );
    }
    program.hook("preAction", (_, command) => {
        initializeSecrets(program, allowDefaultSecrets);
    });

    return program;
}

function initializeSecrets(program: Command, allowDefaultSecrets: boolean) {
    const secretsPath = getSecretsPath(program, allowDefaultSecrets);
    if (!secretsPath) {
        throw new CommandLineError("Missing secrets file. Perhaps you need to add argument --secrets.");
    }
    resetSecrets(secretsPath);
}

function getSecretsPath(program: Command, allowDefaultSecrets: boolean) {
    const options: { secrets?: string } = program.opts();
    if (options.secrets != null) {
        return options.secrets;
    } else if (allowDefaultSecrets) {
        const defaultSecretsPath = path.resolve(os.homedir(), "fasset/secrets.json");
        if (fs.existsSync(defaultSecretsPath)) {
            return defaultSecretsPath;
        }
    }
    return null;
}
