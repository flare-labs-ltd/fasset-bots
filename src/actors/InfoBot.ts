import chalk from "chalk";
import crypto from "node:crypto";
import { BotConfigFile, BotFAssetInfo, createWalletClient, encodedChainId, loadConfigFile } from "../config/BotConfig";
import { createNativeContext } from "../config/create-asset-context";
import { NativeAccount, Secrets, UnifiedAccount, getSecrets } from "../config/secrets";
import { IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { AssetManagerSettings, AvailableAgentInfo } from "../fasset/AssetManagerTypes";
import { printAgentInfo } from "../utils/fasset-helpers";
import { CommandLineError, requireNotNull } from "../utils/helpers";
import { logger } from "../utils/logger";
import { authenticatedHttpProvider, initWeb3, web3 } from "../utils/web3";

// This key is only for fetching info from the chain; don't ever use it or send any tokens to it!
const INFO_ACCOUNT_KEY = "0x4a2cc8e041ff98ef4daad2e5e4c1c3f3d5899cf9d0d321b1243e0940d8281c33";

export type SecretsUser = "user" | "agent" | "other";

export class InfoBot {
    context!: IAssetNativeChainContext;
    config!: BotConfigFile;
    fassetInfo!: BotFAssetInfo;
    nativeAddress!: string;
    underlyingAddress!: string;

    /**
     * Creates instance of InfoBot.
     * @param config path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of InfoBot
     */
    static async create(configFile: string, fAssetSymbol?: string): Promise<InfoBot> {
        const bot = new InfoBot();
        await bot.initialize(configFile, fAssetSymbol);
        return bot;
    }

    /**
     * Initializes asset context from AgentBotRunConfig.
     * @param configFile path to configuration file
     * @param fAssetSymbol symbol for the fasset
     */
    async initialize(configFile: string, fAssetSymbol?: string): Promise<void> {
        logger.info(`InfoBot started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        this.config = loadConfigFile(configFile, `InfoBot`);
        // init web3 and accounts
        await initWeb3(authenticatedHttpProvider(this.config.rpcUrl, getSecrets().apiKey.native_rpc), [INFO_ACCOUNT_KEY], null);
        // create config
        const chainConfig = fAssetSymbol ? this.config.fAssetInfos.find((cc) => cc.fAssetSymbol === fAssetSymbol) : this.config.fAssetInfos[0];
        if (chainConfig == null) {
            logger.error(`InfoBot: FAsset does not exist.`);
            throw new CommandLineError("FAsset does not exist");
        }
        this.context = await createNativeContext(this.config, chainConfig);
        this.fassetInfo = chainConfig;
        // done
        logger.info(`InfoBot successfully finished initializing cli environment.`);
        console.error(chalk.cyan("Environment successfully initialized."));
    }

    generateSecrets(users: SecretsUser[]) {
        // will only generate underlying accounts for the first fasset chain (enough for beta, where only one chain is supported)
        const walletUrl = requireNotNull(this.fassetInfo.walletUrl, "walletUrl config parameter is required");
        const sourceId = encodedChainId(this.fassetInfo.chainId);
        const walletClient = createWalletClient(sourceId, walletUrl, this.fassetInfo.inTestnet);
        function generateAccount(): UnifiedAccount {
            const account = web3.eth.accounts.create();
            const underlyingAccount = walletClient.createWallet();
            return {
                native_address: account.address,
                native_private_key: account.privateKey,
                underlying_address: underlyingAccount.address,
                underlying_private_key: underlyingAccount.privateKey,
            };
        }
        function generateNativeAccount(): NativeAccount {
            const account = web3.eth.accounts.create();
            return {
                native_address: account.address,
                native_private_key: account.privateKey,
            };
        }
        const secrets: Secrets = { apiKey: {} };
        secrets.apiKey.native_rpc = "";
        if (users.includes("agent") || users.includes("user")) {
            secrets.apiKey.xrp_rpc = "";
            secrets.apiKey.indexer = "";
        }
        if (users.includes("agent")) {
            secrets.apiKey.agent_bot = crypto.randomBytes(32).toString("hex");
            secrets.wallet = {
                encryption_password: crypto.randomBytes(15).toString("base64"),
            };
            secrets.owner = generateAccount();
        }
        if (users.includes("user")) {
            secrets.user = generateAccount();
        }
        if (users.includes("other")) {
            secrets.challenger = generateNativeAccount();
            secrets.systemKeeper = generateNativeAccount();
            secrets.timeKeeper = generateNativeAccount();
        }
        return secrets;
    }

    /**
     * Gets available agents.
     * @returns list of objects AvailableAgentInfo
     */
    async getAvailableAgents(chunkSize = 10): Promise<AvailableAgentInfo[]> {
        const result: AvailableAgentInfo[] = [];
        let start = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { 0: list } = await this.context.assetManager.getAvailableAgentsDetailedList(start, start + chunkSize);
            result.splice(result.length, 0, ...list);
            if (list.length < chunkSize) break;
            start += list.length;
        }
        return result;
    }

    /**
     * Gets all agents.
     * @returns list of vault addresses
     */
    async getAllAgents(chunkSize = 10): Promise<string[]> {
        const result: string[] = [];
        let start = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { 0: list } = await this.context.assetManager.getAllAgents(start, start + chunkSize);
            result.splice(result.length, 0, ...list);
            if (list.length < chunkSize) break;
            start += list.length;
        }
        return result;
    }

    async printSystemInfo() {
        const fAsset = this.context.fAsset;
        const assetManager = this.context.assetManager;
        const settings = await assetManager.getSettings();
        const symbol = await fAsset.symbol();
        console.log(`FAsset: ${await fAsset.name()} (${symbol}) at ${fAsset.address}`);
        console.log(`Asset manager: ${assetManager.address}`);
        const mintedWei = await fAsset.totalSupply();
        const minted = Number(mintedWei) / Number(settings.assetUnitUBA);
        const lotSizeUBA = await this.getLotSize(settings);
        const mintedLots = Number(mintedWei) / lotSizeUBA;
        console.log(`Minted: ${minted.toFixed(2)} ${symbol}  (${mintedLots.toFixed(2)} lots)`);
    }

    async printAvailableAgents() {
        logger.info(`InfoBot started fetching available agents.`);
        const agents = await this.getAvailableAgents();
        console.log(`${"ADDRESS".padEnd(42)}  ${"MAX_LOTS".padEnd(8)}  ${"FEE".padEnd(6)}`);
        let loggedAgents = ``;
        for (const agent of agents) {
            const lots = String(agent.freeCollateralLots);
            const fee = Number(agent.feeBIPS) / 100;
            console.log(`${agent.agentVault.padEnd(42)}  ${lots.padStart(8)}  ${fee.toFixed(2).padStart(5)}%`);
            loggedAgents += `InfoBot fetched agent: ${agent.agentVault.padEnd(42)}  ${lots.padStart(8)}  ${fee.toFixed(2).padStart(5)}%\n`;
        }
        logger.info(loggedAgents);
        logger.info(`InfoBot finished fetching available agents.`);
    }

    async printAllAgents() {
        console.log("-------------- Agents --------------");
        console.log(`${"Vault address".padEnd(42)}  ${"Owner address".padEnd(42)}  ${"Minted lots".padStart(12)}  ${"Free lots".padStart(12)}  ${"Public"}`);
        const allAgents = await this.getAllAgents();
        const lotSizeUBA = await this.getLotSize();
        for (const vaultAddr of allAgents) {
            const info = await this.context.assetManager.getAgentInfo(vaultAddr);
            const mintedLots = Number(info.mintedUBA) / lotSizeUBA;
            const freeLots = Number(info.freeCollateralLots);
            const available = info.publiclyAvailable ? "YES" : "no";
            console.log(
                `${vaultAddr}  ${info.ownerManagementAddress}  ${mintedLots.toFixed(2).padStart(12)}  ${freeLots.toFixed(0).padStart(12)}  ${available}`
            );
        }
    }

    private async getLotSize(settings?: AssetManagerSettings) {
        settings ??= await this.context.assetManager.getSettings();
        return Number(settings.lotSizeAMG) * Number(settings.assetMintingGranularityUBA);
    }

    async printAgentInfo(vaultAddress: string) {
        await printAgentInfo(vaultAddress, this.context);
    }
}
