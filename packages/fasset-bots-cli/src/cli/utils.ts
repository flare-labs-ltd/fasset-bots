import "dotenv/config";
import "source-map-support/register";

import { ChainId, InfoBotCommands } from "@flarelabs/fasset-bots-core";
import { BotConfigFile, BotFAssetInfo, Secrets, createBlockchainWalletHelper, loadAgentConfigFile, loadConfigFile, loadContracts, overrideAndCreateOrm } from "@flarelabs/fasset-bots-core/config";
import { BN_ZERO, CommandLineError, Currency, TokenBalances, artifacts, assertNotNullCmd, authenticatedHttpProvider, initWeb3, requiredAddressBalance, requireNotNull, requireNotNullCmd, toBN } from "@flarelabs/fasset-bots-core/utils";
import chalk from "chalk";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { validateAddress } from "../utils/validation";
import { BlockchainWalletHelper } from "../../../fasset-bots-core/src/underlying-chain/BlockchainWalletHelper";
import BN from "bn.js";

const ERC20 = artifacts.require("IERC20Metadata");

const program = programWithCommonOptions("agent", "all_fassets");

program.name("utils").description("Command line blockchain helpers");

program
    .command("transfer")
    .description("transfer underlying tokens")
    .argument("<token>", "token symbol")
    .argument("<from>", "source address")
    .argument("<to>", "destination address")
    .argument("<amount>", "amount to send")
    .argument("[reference]", "payment reference")
    .action(async (token: string, from: string, to: string, amount: string, reference: string | null) => {
        const options: { config: string } = program.opts();
        const config = loadConfigFile(options.config);
        const [_, fassetSymbol] = findToken(config, token);
        assertNotNullCmd(fassetSymbol, `Invalid underlying token ${token}`);
        const { wallet, fassetInfo } = await setupContext(fassetSymbol);
        const currency = new Currency(fassetInfo.tokenSymbol, fassetInfo.tokenDecimals);
        const amountBN = currency.parse(amount);
        const minBN = currency.parse(fassetInfo.minimumAccountBalance ? fassetInfo.minimumAccountBalance.toString() : BN_ZERO.toString());
        await enoughUnderlyingFunds(wallet, from, amountBN, minBN);
        const tx = await wallet.addTransaction(from, to, amountBN, reference);
        console.log(tx);
    });

program
    .command("balance")
    .description("get token balance for an address")
    .argument("<token>", "token symbol, e.g. FLR or XRP or FXRP (case insensitive; can be native token of one of the supported networks or an fasset)")
    .argument("<address>", "address on the network of the token")
    .action(async (token: string, address: string) => {
        const options: { config: string; secrets: string } = program.opts();
        const config = loadConfigFile(options.config);
        const [type, fassetSymbol] = findToken(config, token);
        if (type === "nat") {
            validateAddress(address, `Address ${address}`);
            const bot = await InfoBotCommands.create(options.secrets, options.config, undefined);
            const balance = await TokenBalances.evmNative(bot.context);
            console.log(await balance.formatBalance(address));
        } else if (type === "fasset") {
            validateAddress(address, `Address ${address}`);
            const bot = await InfoBotCommands.create(options.secrets, options.config, fassetSymbol);
            const balance = await TokenBalances.fasset(bot.context);
            console.log(await balance.formatBalance(address));
        } else if (type === "erc20") {
            validateAddress(address, `Address ${address}`);
            const secrets = Secrets.load(options.secrets);
            const config = loadConfigFile(options.config);
            const apiKey = secrets.optional("apiKey.native_rpc");
            await initWeb3(authenticatedHttpProvider(config.rpcUrl, apiKey), [], null);
            const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
            const tokenCtr = requireNotNullCmd(contracts[token], `Unknown token "${token}"`);
            const tokenContract = await ERC20.at(tokenCtr.address);
            const balance = await TokenBalances.erc20(tokenContract);
            console.log(await balance.formatBalance(address));
        } else {
            const fassetInfo = config.fAssets[requireNotNull(fassetSymbol)];
            const secrets = Secrets.load(options.secrets);
            const chainId = ChainId.from(fassetInfo.chainId);
            const wallet = createBlockchainWalletHelper("user", secrets, chainId, undefined, requireNotNull(fassetInfo.walletUrl));
            const balance = await TokenBalances.wallet(wallet, fassetInfo.tokenSymbol, fassetInfo.tokenDecimals);
            console.log(await balance.formatBalance(address));
        }
    });

program
    .command("addTransaction")
    .description("add underlying transaction (like 'transfer', but accepts amount in drops/satoshi)")
    .addOption(program.createOption("-f, --fasset <fAssetSymbol>", "The symbol of the FAsset").makeOptionMandatory())
    .argument("<from>", "source address")
    .argument("<to>", "destination address")
    .argument("<amount>", "amount to send")
    .argument("[reference]", "payment reference")
    .action(async (from: string, to: string, amount: string, reference: string | null, cmdOptions: { fasset: string }) => {
        const { wallet, fassetInfo } = await setupContext(cmdOptions.fasset);
        const currency = new Currency(fassetInfo.tokenSymbol, fassetInfo.tokenDecimals);
        const minBN = currency.parse(fassetInfo.minimumAccountBalance ? fassetInfo.minimumAccountBalance.toString() : BN_ZERO.toString());
        await enoughUnderlyingFunds(wallet, from, toBN(amount), minBN);
        const tx = await wallet.addTransaction(from, to, amount, reference);
        console.log(tx);
    });

toplevelRun(async () => {
    await program.parseAsync();
});

function findToken(config: BotConfigFile, symbol: string): [type: "nat" | "fasset" | "underlying" | "erc20", fassetSymbol?: string] {
    symbol = symbol.toUpperCase();
    if (symbol === "NAT" || symbol === config.nativeChainInfo.tokenSymbol.toUpperCase()) {
        return ["nat"];
    }
    for (const [fassetSymbol, fassetInfo] of Object.entries(config.fAssets)) {
        if (symbol === fassetSymbol.toUpperCase()) {
            return ["fasset", fassetSymbol];
        }
        if (symbol === fassetInfo.tokenSymbol.toUpperCase()) {
            return ["underlying", fassetSymbol];
        }
    }
    return ["erc20"];
}

async function setupContext(fAssetSymbol: string): Promise<{ wallet: BlockchainWalletHelper, fassetInfo: BotFAssetInfo}> {
    console.log(chalk.cyan("Initializing wallet..."));
    const options: { config: string; secrets: string } = program.opts();
    const secrets = Secrets.load(options.secrets);
    const runConfig = loadAgentConfigFile(options.config);
    if (!runConfig.ormOptions) {
        throw new CommandLineError("Missing ormOptions in runConfig");
    }
    const orm = await overrideAndCreateOrm(runConfig.ormOptions, secrets.data.database);
    const chainConfig = runConfig.fAssets[fAssetSymbol];
    if (chainConfig == null) {
        throw new CommandLineError("Invalid FAsset symbol");
    }
    if (!chainConfig.walletUrl) {
        throw new CommandLineError("Missing wallet url");
    }
    const chainId = ChainId.from(chainConfig.chainId);
    const walletHelper = createBlockchainWalletHelper("agent", secrets, chainId, orm.em, chainConfig.walletUrl, runConfig.walletOptions);
    console.log(chalk.cyan("Wallet initialized."));
    return { wallet: walletHelper, fassetInfo: chainConfig };
}

async function enoughUnderlyingFunds(wallet: BlockchainWalletHelper, sourceAddress: string, amount: BN, minimumBalance: BN): Promise<void> {
    const senderBalance = await wallet.getBalance(sourceAddress);
    const fee = await wallet.getTransactionFee();
    const requiredBalance = requiredAddressBalance(amount, minimumBalance, fee);
    if (senderBalance.gte(requiredBalance)) {
        return ;
    } else {
        throw new CommandLineError("Not enough funds in ${sourceAddress}.")
    }
}
