import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { CommandLineError, requireEnv, toplevelRun } from "../utils/helpers";
import { createBlockchainWalletHelper, loadAgentConfigFile } from "../config/BotConfig";
import chalk from "chalk";
import { overrideAndCreateOrm } from "../mikro-orm.config";
import { encodeAttestationName } from "@flarenetwork/state-connector-protocol";

const RUN_CONFIG_PATH: string = requireEnv("RUN_CONFIG_PATH");

const program = new Command();

program.addOption(program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset to mint, redeem or query").makeOptionMandatory(true));

program.name("utils").description("Command line commands for AgentBot");

program
    .command("addTransaction")
    .description("add underlying transaction")
    .argument("<from>", "source address")
    .argument("<to>", "destination address")
    .argument("<amount>", "amount to send")
    .argument("[reference]", "payment reference")
    .action(async (from: string, to: string, amount: string, reference: string | null) => {
        const options: { fasset: string } = program.opts();
        const wallet = await setupContext(options.fasset);
        const tx = await wallet.addTransaction(from, to, amount, reference);
        console.log(tx);
    });

toplevelRun(async () => {
    await program.parseAsync();
});

async function setupContext(fAssetSymbol: string) {
    console.log(chalk.cyan("Initializing wallet..."));
    const runConfig = loadAgentConfigFile(RUN_CONFIG_PATH);
    if (!runConfig.ormOptions) {
        throw new CommandLineError("Missing ormOptions in runConfig");
    }
    const orm = await overrideAndCreateOrm(runConfig.ormOptions);
    const chainConfig = runConfig.fAssetInfos.find((cc) => cc.fAssetSymbol === fAssetSymbol);
    if (chainConfig == null) {
        throw new CommandLineError("Invalid FAsset symbol");
    }
    if (!chainConfig.walletUrl) {
        throw new CommandLineError("Missing wallet url");
    }
    const walletHelper = createBlockchainWalletHelper(encodeAttestationName(chainConfig.chainId), orm.em, chainConfig.walletUrl);
    console.log(chalk.cyan("Wallet initialized."));
    return walletHelper;
}
