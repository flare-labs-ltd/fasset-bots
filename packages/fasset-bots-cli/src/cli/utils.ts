import "dotenv/config";
import "source-map-support/register";

import { createBlockchainWalletHelper, loadAgentConfigFile, overrideAndCreateOrm } from "@flarelabs/fasset-bots-core/config";
import { CommandLineError, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { encodeAttestationName } from "@flarenetwork/state-connector-protocol";
import chalk from "chalk";
import { programWithCommonOptions } from "../utils/program";


const program = programWithCommonOptions("bot", "single_fasset");

program.name("utils").description("Command line command helpers");

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
    const options: { config: string } = program.opts();
    const runConfig = loadAgentConfigFile(options.config);
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
    const walletHelper = createBlockchainWalletHelper(encodeAttestationName(chainConfig.chainId), orm.em, chainConfig.walletUrl, runConfig.walletOptions);
    console.log(chalk.cyan("Wallet initialized."));
    return walletHelper;
}
