import "dotenv/config";
import "source-map-support/register";

import { BlockchainWalletHelper, ChainId, DBWalletKeys } from "@flarelabs/fasset-bots-core";
import { BotConfigFile, BotFAssetInfo, ChainAccount, Secrets, createBlockchainWalletHelper, createBotConfig, createNativeContext, loadConfigFile, loadContracts, overrideAndCreateOrm } from "@flarelabs/fasset-bots-core/config";
import { CommandLineError, Currencies, Currency, EVMNativeTokenBalance, TokenBalances, artifacts, assertNotNullCmd, authenticatedHttpProvider, initWeb3, requireNotNull, requiredAddressBalance, toBN, web3 } from "@flarelabs/fasset-bots-core/utils";
import BN from "bn.js";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { validateAddress } from "../utils/validation";

const ERC20 = artifacts.require("IERC20Metadata");

const program = programWithCommonOptions("user", "all_fassets");

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
        let account = getAccountFromSecrets(secrets, token, from);
        if (account == null) {
            validateAddressForType(token, from);
            account = await getAccountFromDBWallet(config, secrets, from);
        }
        validateAddressForType(token, to);
        if (token.type === "nat") {
            await initializeWeb3(config, secrets, [account]);
            const currency = new Currency(config.nativeChainInfo.tokenSymbol, 18);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            await web3.eth.sendTransaction({ from: account.address, to: to, value: String(amountNat), gas: 100_000 });
        } else if (token.type === "erc20") {
            await initializeWeb3(config, secrets, [account]);
            const tokenContract = await ERC20.at(token.address);
            const currency = await Currencies.erc20(tokenContract);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            await tokenContract.transfer(to, amountNat, { from: account.address });
        } else if (token.type === "fasset") {
            await initializeWeb3(config, secrets, [account]);
            const botConfig = await createBotConfig("common", secrets, config);
            const context = await createNativeContext(botConfig, requireNotNull(botConfig.fAssets.get(token.fassetSymbol)));
            const currency = await Currencies.fasset(context);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            await context.fAsset.transfer(to, amountNat, { from: account.address });
        } else if (token.type === "underlying") {
            const chainInfo = token.chainInfo;
            const chainId = ChainId.from(chainInfo.chainId);
            const wallet = createBlockchainWalletHelper("user", secrets, chainId, undefined, requireNotNull(chainInfo.walletUrl));
            await wallet.addExistingAccount(account.address, account.private_key);
            const currency = new Currency(chainInfo.tokenSymbol, chainInfo.tokenDecimals);
            const amountNat = cmdOptions.baseUnit ? toBN(amount) : currency.parse(amount);
            const minBN = currency.parse(token.chainInfo.minimumAccountBalance ?? "0");
            await enoughUnderlyingFunds(wallet, from, to, amountNat, minBN);
            await wallet.addTransaction(account.address, to, amountNat, cmdOptions.reference ?? null);
        }
    });


program
    .command("balance")
    .description("get token balance for an address")
    .argument("<token>", "token symbol, e.g. FLR or XRP or FXRP (case insensitive; can be native token of one of the supported networks or an fasset)")
    .argument("<address>", "address on the network of the token")
    .option("-b, --baseUnit", "print amount in base unit of the token (wei / drops / satoshi); otherwise it is in whole tokens with decimals")
    .action(async (tokenSymbol: string, address: string, cmdOptions: { baseUnit?: boolean }) => {
        const options: { config: string; secrets: string } = program.opts();
        const config = loadConfigFile(options.config);
        const secrets = Secrets.load(options.secrets);
        const token = findToken(config, tokenSymbol);
        validateAddressForType(token, address);
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
            const chainInfo = token.chainInfo;
            const chainId = ChainId.from(chainInfo.chainId);
            const wallet = createBlockchainWalletHelper("user", secrets, chainId, undefined, requireNotNull(chainInfo.walletUrl));
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
    if (token.type === "underlying") {
        const ownerAccount = secrets.data.owner?.[token.chainInfo.tokenSymbol];
        if (ownerAccount) result.owner = ownerAccount;
        const userAccount = secrets.data.user?.[token.chainInfo.tokenSymbol];
        if (userAccount) result.user = userAccount;
    } else {
        for (const [key, acc] of Object.entries(secrets.data)) {
            if (isChainAccount(acc)) result[key] = acc;
        }
        const ownerAccount = secrets.data.owner?.native;
        if (ownerAccount) result.owner = ownerAccount;
        const userAccount = secrets.data.user?.native;
        if (userAccount) result.user = userAccount;
    }
    return result;
}

function isChainAccount(rec: any): rec is ChainAccount {
    return rec && typeof rec.address === "string" && typeof rec.private_key === "string";
}

async function getAccountFromDBWallet(config: BotConfigFile, secrets: Secrets, address: string): Promise<ChainAccount> {
    assertNotNullCmd(config.ormOptions, "'from' account private key not found in options and no database config found to search in db wallet");
    const orm = await overrideAndCreateOrm(config.ormOptions, secrets.data.database);
    assertNotNullCmd(secrets.data.wallet, "'from' account private key not found in options and no wallet password found to search in db wallet");
    const walletKeys = new DBWalletKeys(orm.em, secrets.data.wallet.encryption_password);
    const privateKey = await walletKeys.getKey(address);
    assertNotNullCmd(privateKey, `private key for address ${address}`);
    return { address, private_key: privateKey };
}

function validateAddressForType(token: TokenType, address: string) {
    if (token.type !== "underlying") {
        validateAddress(address, `Address ${address}`);
    }
}

async function enoughUnderlyingFunds(wallet: BlockchainWalletHelper, sourceAddress: string, destinationAddress: string, amount: BN, minimumBalance: BN): Promise<void> {
    const senderBalance = await wallet.getBalance(sourceAddress);
    const fee = await wallet.getTransactionFee({source: sourceAddress, amount: amount, destination: destinationAddress, isPayment: true});
    const requiredBalance = requiredAddressBalance(amount, minimumBalance, fee);
    if (senderBalance.gte(requiredBalance)) {
        return;
    } else {
        throw new CommandLineError("Not enough funds in ${sourceAddress}.")
    }
}
