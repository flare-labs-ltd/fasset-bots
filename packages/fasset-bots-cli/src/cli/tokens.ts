import "dotenv/config";
import "source-map-support/register";

import { BlockchainWalletHelper, ChainId, DBWalletKeys, VerificationPrivateApiClient } from "@flarelabs/fasset-bots-core";
import {
    BotConfigFile, BotFAssetInfo, ChainAccount, Secrets, createBlockchainWalletHelper, createBotConfig, createBotOrm, createNativeContext,
    loadConfigFile, loadContracts, overrideAndCreateOrm,
} from "@flarelabs/fasset-bots-core/config";
import {
    CommandLineError, Currencies, Currency, EVMNativeTokenBalance, TokenBalances, artifacts, assertNotNullCmd, authenticatedHttpProvider, initWeb3, logger,
    requireNotNull, requiredAddressBalance, sendWeb3Transaction, toBN
} from "@flarelabs/fasset-bots-core/utils";
import BN from "bn.js";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { validateAddress } from "../utils/validation";

const ERC20 = artifacts.require("IERC20Metadata");

const program = programWithCommonOptions("agent", "all_fassets");

program.name("tokens").description("Command line token balance and transfer");

program
    .command("transfer")
    .description("transfer underlying tokens, ERC20 tokens or native token")
    .argument("<token>", "token symbol")
    .argument("<from>", "source address or a key in secrets ('user', 'owner', 'liquidator', etc.)")
    .argument("<to>", "destination address")
    .argument("<amount>", "amount to send")
    .option("-r, --reference <reference>", "payment reference; only used for underlying payments")
    .option("-b, --baseUnit", "amount is in base unit of the token (wei / drops / satoshi); otherwise it is in whole tokens with decimals")
    .action(async (tokenSymbol: string, from: string, to: string, amount: string, cmdOptions: { reference?: string, baseUnit?: boolean }) => {
        const options: { config: string; secrets: string } = program.opts();
        const config = loadConfigFile(options.config);
        const secrets = Secrets.load(options.secrets);
        const token = findToken(config, tokenSymbol);
        const accountFrom = await getAccount(config, secrets, token, from);
        const addressTo = await getAddress(secrets, token, to);
        if (token.type === "nat") {
            await initializeWeb3(config, secrets, [accountFrom]);
            const currency = new Currency(config.nativeChainInfo.tokenSymbol, 18);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            await sendWeb3Transaction({ from: accountFrom.address, to: addressTo, value: String(amountNat), gas: 100_000 });
        } else if (token.type === "erc20") {
            await initializeWeb3(config, secrets, [accountFrom]);
            const tokenContract = await ERC20.at(token.address);
            const currency = await Currencies.erc20(tokenContract);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            await tokenContract.transfer(addressTo, amountNat, { from: accountFrom.address });
        } else if (token.type === "fasset") {
            await initializeWeb3(config, secrets, [accountFrom]);
            const botConfig = await createBotConfig("common", secrets, config);
            const context = await createNativeContext(botConfig, requireNotNull(botConfig.fAssets.get(token.fassetSymbol)));
            const currency = await Currencies.fasset(context);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            await context.fAsset.transfer(addressTo, amountNat, { from: accountFrom.address });
        } else if (token.type === "underlying") {
            const orm = await createBotOrm("user", config.ormOptions, secrets.data.database);
            if (!orm) {
                throw new CommandLineError(`Undefined orm for underlying payment`);
            }
            const chainInfo = token.chainInfo;
            const chainId = ChainId.from(chainInfo.chainId);
            const wallet = await createBlockchainWalletHelper(secrets, chainId, orm.em, requireNotNull(chainInfo.walletUrl), chainInfo.walletApiType ?? null);
            await wallet.addExistingAccount(accountFrom.address, accountFrom.private_key);
            const currency = new Currency(chainInfo.tokenSymbol, chainInfo.tokenDecimals);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            const minBN = currency.parse(token.chainInfo.minimumAccountBalance ?? "0");
            await enoughUnderlyingFunds(wallet, accountFrom.address, addressTo, amountNat, minBN);
            try {
                const stopBot = async () => {
                    console.log("Stopping wallet monitoring...");
                    return wallet.requestStop(true);
                }
                process.on("SIGINT", () => {
                    stopBot().then().catch(logger.error);
                });
                process.on("SIGTERM", () => {
                    stopBot().then().catch(logger.error);
                });
                process.on("SIGQUIT", () => {
                    stopBot().then().catch(logger.error);
                });
                process.on("SIGHUP", () => {
                    stopBot().then().catch(logger.error);
                });
                const txHash = await wallet.addTransactionAndWaitForItsFinalization(accountFrom.address, addressTo, amountNat, cmdOptions.reference ?? null);
                console.info(`Payment transaction ${txHash}. Check transaction status in database or explorer.`);
            } finally {}
        }
    });


program
    .command("balance")
    .description("get token balance for an address")
    .argument("<token>", "token symbol, e.g. FLR or XRP or FXRP (case insensitive; can be native token of one of the supported networks or an fasset)")
    .argument("<address>", "address on the network of the token")
    .option("-b, --baseUnit", "print amount in base unit of the token (wei / drops / satoshi); otherwise it is in whole tokens with decimals")
    .action(async (tokenSymbol: string, addressOrKey: string, cmdOptions: { baseUnit?: boolean }) => {
        const options: { config: string; secrets: string } = program.opts();
        const config = loadConfigFile(options.config);
        const secrets = Secrets.load(options.secrets);
        const token = findToken(config, tokenSymbol);
        const address = await getAddress(secrets, token, addressOrKey);
        if (token.type === "nat") {
            await initializeWeb3(config, secrets, []);
            const balance = new EVMNativeTokenBalance(config.nativeChainInfo.tokenSymbol, 18);
            const amount = await balance.balance(address);
            console.log(cmdOptions.baseUnit ? String(amount) : balance.format(amount));
        } else if (token.type === "erc20") {
            await initializeWeb3(config, secrets, []);
            const tokenContract = await ERC20.at(token.address);
            const balance = await TokenBalances.erc20(tokenContract);
            const amount = await balance.balance(address);
            console.log(cmdOptions.baseUnit ? String(amount) : balance.format(amount));
        } else if (token.type === "fasset") {
            await initializeWeb3(config, secrets, []);
            const botConfig = await createBotConfig("common", secrets, config);
            const context = await createNativeContext(botConfig, requireNotNull(botConfig.fAssets.get(token.fassetSymbol)));
            const balance = await TokenBalances.fasset(context);
            const amount = await balance.balance(address);
            console.log(cmdOptions.baseUnit ? String(amount) : balance.format(amount));
        } else if (token.type === "underlying") {
            const orm = await createBotOrm("user", config.ormOptions, secrets.data.database);
            if (!orm) {
                throw new CommandLineError(`Undefined orm for underlying payment`);
            }
            const chainInfo = token.chainInfo;
            const chainId = ChainId.from(chainInfo.chainId);
            const wallet = await createBlockchainWalletHelper(secrets, chainId, orm.em, requireNotNull(chainInfo.walletUrl), chainInfo.walletApiType ?? null);
            const balance = await TokenBalances.wallet(wallet, chainInfo.tokenSymbol, chainInfo.tokenDecimals);
            const amount = await balance.balance(address);
            console.log(cmdOptions.baseUnit ? String(amount) : balance.format(amount));
        }
    });

toplevelRun(async () => {
    await program.parseAsync();
});

type TokenType =
    | { type: "nat" }
    | { type: "erc20", address: string }
    | { type: "fasset", fassetSymbol: string, chainInfo: BotFAssetInfo }
    | { type: "underlying", chainInfo: BotFAssetInfo };

function findToken(config: BotConfigFile, symbol: string): TokenType {
    symbol = symbol.toUpperCase();
    if (symbol === "NAT" || symbol === config.nativeChainInfo.tokenSymbol.toUpperCase()) {
        return { type: "nat" };
    }
    for (const [fassetSymbol, chainInfo] of Object.entries(config.fAssets)) {
        if (symbol === fassetSymbol.toUpperCase()) {
            return { type: "fasset", fassetSymbol, chainInfo };
        }
        if (symbol === chainInfo.tokenSymbol.toUpperCase()) {
            return { type: "underlying", chainInfo };
        }
    }
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    for (const [key, contract] of Object.entries(contracts)) {
        if (symbol === key.toUpperCase()) {
            return { type: "erc20", address: requireNotNull(contract).address };
        }
    }
    throw new CommandLineError(`Unknown token symbol ${symbol}`);
}

async function initializeWeb3(config: BotConfigFile, secrets: Secrets, accounts: ChainAccount[]) {
    const apiKey = secrets.optional("apiKey.native_rpc");
    const privateKeys = accounts.map(acc => acc.private_key);
    await initWeb3(authenticatedHttpProvider(config.rpcUrl, apiKey), privateKeys, null);
}

async function getAccount(config: BotConfigFile, secrets: Secrets, token: TokenType, addressOrKey: string) {
    let account = getAccountFromSecrets(secrets, token, addressOrKey);
    const address = account != null ? account.address : addressOrKey;
    await validateAddressForToken(secrets, token, address);
    if (account == null) {
        account = await getAccountFromDBWallet(config, secrets, addressOrKey);
    }
    if (account == null) {
        throw new CommandLineError(`Could not find private key for account '${addressOrKey}'`);
    }
    return account;
}

async function getAddress(secrets: Secrets, token: TokenType, addressOrKey: string) {
    const account = getAccountFromSecrets(secrets, token, addressOrKey);
    const address = account != null ? account.address : addressOrKey;
    await validateAddressForToken(secrets, token, address);
    return address;
}

function getAccountFromSecrets(secrets: Secrets, token: TokenType, addressOrKey: string): ChainAccount | null {
    const accounts = extractAccountsFromSecrets(secrets, token);
    for (const [key, account] of Object.entries(accounts)) {
        if (addressOrKey === key || addressOrKey === account.address) {
            return account;
        }
    }
    return null;
}

function extractAccountsFromSecrets(secrets: Secrets, token: TokenType) {
    const result: Record<string, ChainAccount> = {};
    for (const [userKey, userAccounts] of Object.entries(secrets.data)) {
        if (token.type !== "underlying" && isChainAccount(userAccounts)) {
            // native accounts can be on toplevel, e.g. `secrets.liquidator`
            result[userKey] = userAccounts;
        } else {
            // check for account of the form `secrets.<userKey>.<type>` e.g. `secrets.user.native` or `secrets.owner.testXRP`
            const tokenAccountKey = token.type === "underlying" ? token.chainInfo.tokenSymbol : "native";
            const account = (userAccounts as Record<string, unknown>)[tokenAccountKey];
            if (isChainAccount(account)) {
                result[userKey] = account;
            }
        }
    }
    return result;
}

function isChainAccount(rec: any): rec is ChainAccount {
    return typeof rec === "object" && rec != null && typeof rec.address === "string" && typeof rec.private_key === "string";
}

async function getAccountFromDBWallet(config: BotConfigFile, secrets: Secrets, address: string): Promise<ChainAccount | null> {
    try {
        const ormOptions = config.ormOptions;
        const walletPassword = secrets.data.wallet?.encryption_password;
        if (ormOptions && walletPassword) {
            const databaseAccount = secrets.data.database;
            const orm = await overrideAndCreateOrm({ ...ormOptions, schemaUpdate: "none" }, databaseAccount);
            const walletKeys = new DBWalletKeys(orm.em, walletPassword);
            const privateKey = await walletKeys.getKey(address);
            if (privateKey) {
                return { address, private_key: privateKey };
            }
            logger.error(`No private key for account '${address}' in database wallet.`);
        } else if (!ormOptions) {
            logger.error(`No database config found to search in db wallet while looking for account '${address}'.`);
        } else if (!walletPassword) {
            logger.error(`No wallet password found to search in db wallet for account '${address}'.`);
        }
    } catch (error) {
        logger.error(`Error searching for account private key for ${address} in database wallet:`, error);
    }
    return null;
}

async function validateAddressForToken(secrets: Secrets, token: TokenType, address: string) {
    if (token.type === "underlying") {
        const chainId = ChainId.from(token.chainInfo.chainId);
        assertNotNullCmd(token.chainInfo.indexerUrl, `Missing indexerUrl for chain ${chainId}`);
        assertNotNullCmd(secrets.data.apiKey.indexer, `Missing indexer api key in secrets`);
        const verificationClient = new VerificationPrivateApiClient(token.chainInfo.indexerUrl, secrets.data.apiKey.indexer);
        const result = await verificationClient.checkAddressValidity(chainId.sourceId, address)
            .catch(e => {
                logger.error(`Error validating address ${address} on chain ${chainId}`);
                return null;
            });
        if (result?.isValid === false) {
            throw new CommandLineError(`Address "${address}" has invalid format for chain ${chainId}`);
        }
    } else {
        validateAddress(address, `Address ${address}`);
    }
}

async function enoughUnderlyingFunds(wallet: BlockchainWalletHelper, sourceAddress: string, destinationAddress: string, amount: BN, minimumBalance: BN): Promise<void> {
    const senderBalance = await wallet.getBalance(sourceAddress);
    const fee = await wallet.getTransactionFee({ source: sourceAddress, amount: amount, destination: destinationAddress, isPayment: true });
    const requiredBalance = requiredAddressBalance(amount, minimumBalance, fee);
    if (senderBalance.gte(requiredBalance)) {
        return;
    } else {
        throw new CommandLineError(`Not enough funds in ${sourceAddress}. Balance ${senderBalance.toString()}, fee ${fee.toString()}, amount ${amount.toString()}, required ${requiredBalance.toString()}. (all in uba)`);
    }
}