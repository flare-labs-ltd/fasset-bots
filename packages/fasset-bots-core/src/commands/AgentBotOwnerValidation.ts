import chalk from "chalk";
import { AgentOwnerRegistryInstance, FAssetInstance } from "../../typechain-truffle";
import { BotConfigFile, createBotConfig, createWalletClient } from "../config";
import { AssetContractRetriever } from "../config/AssetContractRetriever";
import { loadConfigFile } from "../config/config-file-loader";
import { Secrets } from "../config/secrets";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { OwnerAddressPair } from "../fasset/Agent";
import { BlockchainWalletHelper } from "../underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../underlying-chain/ChainId";
import { MemoryWalletKeys } from "../underlying-chain/WalletKeys";
import { EVMNativeTokenBalance, WalletTokenBalance } from "../utils/TokenBalance";
import { CommandLineError, assertCmd, assertNotNullCmd } from "../utils/command-line-errors";
import { stripIndent } from "../utils/formatting";
import { ZERO_ADDRESS, requireNotNull } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts, authenticatedHttpProvider, initWeb3, web3 } from "../utils/web3";
import { ORM } from "../config/orm";

const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");

/* istanbul ignore next */
export interface Reporter {
    log: (text: string) => void;
    error: (text: string) => void;
}

// useful for validation from other methods
/* istanbul ignore next */
export const throwingReporter: Reporter = {
    log(text) {},
    error(text) { throw new CommandLineError(text); },
}

export const printingReporter: Reporter & { errorCount: number } = {
    errorCount: 0,
    log(text) { console.log(text); },
    error(text) {
        console.error(chalk.red(`Error:`), text, "\n");
        ++this.errorCount;
    },
};

export class AgentBotOwnerValidation {
    constructor(
        public secrets: Secrets,
        public configFile: BotConfigFile,
        public agentOwnerRegistry: AgentOwnerRegistryInstance,
        public fassets: Map<string, FAssetInstance>,    // fasset symbol => fasset
        public reporter: Reporter = throwingReporter,
        public orm: ORM
    ) {}

    static async create(secretsFile: string, configFileName: string, reporter: Reporter = throwingReporter) {
        const secrets = await Secrets.load(secretsFile);
        const owner = new OwnerAddressPair(secrets.required("owner.management.address"), secrets.required("owner.native.address"));
        const configFile = loadConfigFile(configFileName);
        const apiKey = secrets.optional("apiKey.native_rpc");
        await initWeb3(authenticatedHttpProvider(configFile.rpcUrl, apiKey), [], null);
        const contractRetriever = await AssetContractRetriever.create(configFile.prioritizeAddressUpdater,
            configFile.contractsJsonFile, configFile.assetManagerController);
        const agentOwnerRegistry = await contractRetriever.getContract(AgentOwnerRegistry);
        const fassets = new Map<string, FAssetInstance>();
        for (const [symbol, { fasset }] of contractRetriever.assetManagers) fassets.set(symbol, fasset);
        const botConfig = await createBotConfig("agent", secrets, configFile, owner.workAddress);
        return new AgentBotOwnerValidation(secrets, configFile, agentOwnerRegistry, fassets, reporter, botConfig.orm);
    }

    static async fromContext(context: IAssetAgentContext, secretsFile: string, configFileName: string, reporter: Reporter = throwingReporter) {
        const secrets = await Secrets.load(secretsFile);
        const owner = new OwnerAddressPair(secrets.required("owner.management.address"), secrets.required("owner.native.address"));
        const configFile = loadConfigFile(configFileName);
        const fassets = new Map<string, FAssetInstance>([[context.fAssetSymbol, context.fAsset]]);
        const botConfig = await createBotConfig("agent", secrets, configFile, owner.workAddress);
        return new AgentBotOwnerValidation(secrets, configFile, context.agentOwnerRegistry, fassets, reporter, botConfig.orm);
    }

    async validate(fassetSymbols: string[]) {
        await this.validateOwnerNativeAddresses();
        for (const fassetSymbol of fassetSymbols) {
            await this.validateForFAsset(fassetSymbol);
        }
    }

    async validateOwnerNativeAddresses() {
        const managementAddress = this.secrets.optional("owner.management.address");
        const workAddress = this.secrets.optional("owner.native.address");
        const workPrivateKey = this.secrets.optional("owner.native.private_key");
        this.reporter.log(`Checking owner addresses...`);
        assertCmd(!!managementAddress, `Missing field "owner.management.address" in secrets file ${this.secrets.filePath}. Please set to your metamask or hardware key address.`);
        AgentBotOwnerValidation.validateAddress(managementAddress, `Owner management address ${managementAddress}`);
        assertCmd(!!workAddress, `Missing field "owner.native.address" in secrets file ${this.secrets.filePath}. Did you use "yarn generateSecrets --agent" to generate it?`);
        AgentBotOwnerValidation.validateAddress(managementAddress, `Owner work address ${workAddress}`);
        assertCmd(!!workPrivateKey, `Missing field "owner.native.private_key" in secrets file ${this.secrets.filePath}. Did you use "yarn generateSecrets --agent" to generate it?`);
        const owner = new OwnerAddressPair(managementAddress, workAddress);
        AgentBotOwnerValidation.verifyWorkPrivateKey(owner, workPrivateKey, this.reporter);
        this.reporter.log(`Verifying owner whitelisting...`);
        await AgentBotOwnerValidation.verifyAgentWhitelisted(this.agentOwnerRegistry, owner, this.reporter);
        this.reporter.log(`Verifying owner work address...`);
        await AgentBotOwnerValidation.verifyWorkAddress(this.agentOwnerRegistry, owner, this.reporter);
        await this.verifyOwnerManagementBalance(owner);
        await this.verifyOwnerWorkBalance(owner);
    }

    private async verifyOwnerManagementBalance(owner: OwnerAddressPair) {
        const nativeChainInfo = this.configFile.nativeChainInfo;
        const natToken = new EVMNativeTokenBalance(nativeChainInfo.tokenSymbol, 18);
        // check managementAddress balance
        this.reporter.log(`Verifying balance on management address...`);
        const managementAddressBalance = await natToken.balance(owner.managementAddress);
        const managementAddressRecBal = natToken.parse(nativeChainInfo.recommendedOwnerBalance ?? "0");
        const balanceFmt = natToken.format(managementAddressBalance);
        /* istanbul ignore next */
        if (managementAddressBalance.lt(managementAddressRecBal)) {
            const recBalFmt = natToken.format(managementAddressRecBal);
            const faucetInfo = nativeChainInfo.faucet ? `\nGo to [${nativeChainInfo.faucet}] and fund [${owner.workAddress}].` : "";
            this.reporter.error(`Agent management address (${owner.managementAddress}) balance must be at least ${recBalFmt} (current balance is ${balanceFmt}).${faucetInfo}`);
        } else {
            this.reporter.log(`    management address has balance ${balanceFmt}.`);
        }
    }

    private async verifyOwnerWorkBalance(owner: OwnerAddressPair) {
        const nativeChainInfo = this.configFile.nativeChainInfo;
        const natToken = new EVMNativeTokenBalance(nativeChainInfo.tokenSymbol, 18);
        // check workAddress balance
        this.reporter.log(`Verifying balance on work address...`);
        const workAddressBalance = await natToken.balance(owner.workAddress);
        const workAddressRecBal = natToken.parse(nativeChainInfo.recommendedOwnerBalance ?? "0");
        const balanceFmt = natToken.format(workAddressBalance);
        /* istanbul ignore next */
        if (workAddressBalance.lt(workAddressRecBal)) {
            const recBalFmt = natToken.format(workAddressRecBal);
            const faucetInfo = nativeChainInfo.faucet
                ? `\nGo to [${nativeChainInfo.faucet}] and fund [${owner.workAddress}] or transfer some ${natToken.symbol} from management address.`
                : `\nTransfer some ${natToken.symbol} from management address.`;
            this.reporter.error(`Agent work address (${owner.managementAddress}) balance must be at least ${recBalFmt} (current balance is ${balanceFmt}).${faucetInfo}`);
        } else {
            this.reporter.log(`    work address has balance ${balanceFmt}.`);
        }
    }

    async validateForFAsset(fassetSymbol: string) {
        this.reporter.log(`Verifying ${fassetSymbol} settings...`);
        const fassetInfo = this.configFile.fAssets[fassetSymbol];
        assertNotNullCmd(fassetInfo, `Invalid FAsset symbol ${fassetSymbol}.`);
        assertNotNullCmd(fassetInfo.walletUrl, `Missing field fAssets.${fassetSymbol}.walletUrl in the config file.`);
        //
        const underlyingAddress = this.secrets.optional(`owner.${fassetInfo.chainId}.address`);
        assertCmd(!!underlyingAddress, `Missing field "owner.${fassetInfo.chainId}.address" in secrets file ${this.secrets.filePath}. Did you use "yarn generateSecrets --agent" to generate it?`);
        //
        this.reporter.log(`Verifying balance on owner's ${fassetInfo.chainId} address ${underlyingAddress}...`);
        const walletToken = await this.createWalletTokenBalance(fassetSymbol);
        const underlyingBalance = await walletToken.balance(underlyingAddress);
        const underlyingRecBal = walletToken.parse(this.configFile.agentBotSettings.fAssets[fassetSymbol].recommendedOwnerBalance ?? "0");
        const balanceFmt = walletToken.format(underlyingBalance);
        /* istanbul ignore next */
        if (underlyingBalance.lt(underlyingRecBal)) {
            const recBalFmt = walletToken.format(underlyingRecBal);
            const faucetInfo = fassetInfo.faucet ? `\nGo to [${fassetInfo.faucet}] and fund [${underlyingAddress}].` : "";
            this.reporter.error(`Owner's ${fassetInfo.chainId} address (${underlyingAddress}) balance must be at least ${recBalFmt} (current balance is ${balanceFmt}).${faucetInfo}`);
        } else {
            this.reporter.log(`    owner's ${fassetInfo.chainId} address has balance ${balanceFmt}.`);
        }
    }

    async createWalletTokenBalance(fassetSymbol: string) {
        const fassetInfo = this.configFile.fAssets[fassetSymbol];
        const walletClient = await createWalletClient(this.secrets, ChainId.from(fassetInfo.chainId), requireNotNull(fassetInfo.walletUrl), this.orm.em, fassetInfo.stuckTransactionOptions, fassetInfo.feeServiceOptions, fassetInfo.fallbackApis);
        const wallet = new BlockchainWalletHelper(walletClient, new MemoryWalletKeys());
        const fasset = requireNotNull(this.fassets.get(fassetSymbol));
        return new WalletTokenBalance(wallet, await fasset.assetSymbol(), Number(await fasset.decimals()));
    }

    static verifyWorkPrivateKey(owner: OwnerAddressPair, workPrivateKey: string, reporter = throwingReporter) {
        // validate that owner's private key is correct
        const account = web3.eth.accounts.privateKeyToAccount(workPrivateKey);
        if (account.address !== owner.workAddress) {
            logger.error(`Owner ${owner.managementAddress} has invalid address/private key pair.`);
            reporter.error(`Owner work address ${owner.workAddress} has invalid private key.`);
        }
    }

    static async verifyAgentWhitelisted(agentOwnerRegistry: AgentOwnerRegistryInstance, owner: OwnerAddressPair, reporter = throwingReporter) {
        const whitelisted = await agentOwnerRegistry.isWhitelisted(owner.managementAddress);
        /* istanbul ignore next */
        if (!whitelisted) {
            reporter.error(stripIndent`Agent registry management address is not whitelisted.
                                       Contact Flare agent support to whitelist your address [${owner.managementAddress}].`);
        } else {
            reporter.log(`    owner's management address is whitelisted.`);
        }
    }

    static async verifyWorkAddress(agentOwnerRegistry: AgentOwnerRegistryInstance, owner: OwnerAddressPair, reporter = throwingReporter) {
        // get work address
        const chainWorkAddress = await agentOwnerRegistry.getWorkAddress(owner.managementAddress);
        // ensure that work address is defined and matches the one from secrets.json
        const explorerUrl = `https://coston-explorer.flare.network/address/${agentOwnerRegistry.address}/write-contract#address-tabs`;
        /* istanbul ignore next */
        if (chainWorkAddress === ZERO_ADDRESS) {
            reporter.error(stripIndent`Owner management address ${owner.managementAddress} has no registered work address.
                                       Go to [${explorerUrl}], enable MetaMask and set '8. setWorkAddress' to [${owner.workAddress}].`);
        } else if (chainWorkAddress !== owner.workAddress) {
            reporter.error(stripIndent`Owner management address ${owner.managementAddress} has registered work address ${chainWorkAddress},
                                       which doesn't match the work address ${owner.workAddress} in the secrets file.
                                       Go to [${explorerUrl}], enable MetaMask and set '8. setWorkAddress' to [${owner.workAddress}].
                                       Note that only one work address can be set for one management address, so previous work address will not work anymore.`);
        } else {
            reporter.log(`    owner work address is registered correctly.`);
        }
    }

    static validateAddress(address: string | null | undefined, what: string) {
        if (address == null) return;
        assertCmd(/0x[0-9a-fA-F]{40}/.test(address), `"${what}" is in invalid format.`);
        assertCmd(web3.utils.checkAddressChecksum(address), `"${what}" has invalid EIP-55 checksum.`);
    }
}
