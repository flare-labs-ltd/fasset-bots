import chalk from "chalk";
import { loadConfigFile } from "../config/BotConfig";
import { BotConfigFile, BotFAssetInfo } from "../config/config-files";
import { createNativeContext } from "../config/create-asset-context";
import { getSecrets } from "../config/secrets";
import { IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { AssetManagerSettings, AvailableAgentInfo } from "../fasset/AssetManagerTypes";
import { printAgentInfo } from "../utils/fasset-helpers";
import { CommandLineError, MAX_BIPS, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import BN from "bn.js";

// This key is only for fetching info from the chain; don't ever use it or send any tokens to it!
const INFO_ACCOUNT_KEY = "0x4a2cc8e041ff98ef4daad2e5e4c1c3f3d5899cf9d0d321b1243e0940d8281c33";

const CollateralPool = artifacts.require("CollateralPool");
const IERC20Metadata = artifacts.require("IERC20Metadata");

export class InfoBot {
    constructor(
        public context: IAssetNativeChainContext,
        public config: BotConfigFile,
        public fassetInfo: BotFAssetInfo
    ) {}

    /**
     * Creates instance of InfoBot.
     * @param config path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of InfoBot
     */
    static async create(configFile: string, fAssetSymbol?: string): Promise<InfoBot> {
        logger.info(`InfoBot started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        const config = loadConfigFile(configFile, `InfoBot`);
        // init web3 and accounts
        await initWeb3(authenticatedHttpProvider(config.rpcUrl, getSecrets().apiKey.native_rpc), [INFO_ACCOUNT_KEY], null);
        // create config
        const chainConfig = fAssetSymbol ? config.fAssetInfos.find((cc) => cc.fAssetSymbol === fAssetSymbol) : config.fAssetInfos[0];
        if (chainConfig == null) {
            logger.error(`InfoBot: FAsset does not exist.`);
            throw new CommandLineError("FAsset does not exist");
        }
        const context = await createNativeContext(config, chainConfig);
        // done
        logger.info(`InfoBot successfully finished initializing cli environment.`);
        console.error(chalk.cyan("Environment successfully initialized."));
        return new InfoBot(context, config, chainConfig);
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

    async findBestAgent(minAvailableLots: BN): Promise<string | undefined> {
        const agents = await this.getAvailableAgents();
        const eligible = agents.filter((a) => toBN(a.freeCollateralLots).gte(minAvailableLots));
        eligible.sort((a, b) => -toBN(a.feeBIPS).cmp(toBN(b.feeBIPS)));
        return eligible[0]?.agentVault;
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
        const printer = new ColumnPrinter([
            ["ADDRESS", 42, "l"],
            ["MAX_LOTS", 8, "r"],
            ["FEE", 6, "r"],
        ]);
        printer.printHeader();
        let loggedAgents = ``;
        for (const agent of agents) {
            const lots = String(agent.freeCollateralLots);
            const fee = Number(agent.feeBIPS) / 100;
            const line = printer.line(agent.agentVault, lots, fee.toFixed(2));
            console.log(line);
            loggedAgents += `InfoBot fetched agent: ${line}\n`;
        }
        logger.info(loggedAgents);
        logger.info(`InfoBot finished fetching available agents.`);
    }

    async printPools() {
        logger.info(`InfoBot started fetching pools.`);
        const settings = await this.context.assetManager.getSettings();
        const fassetSymbol = await this.context.fAsset.symbol();
        const agents = await this.getAvailableAgents();
        const printer = new ColumnPrinter([
            ["Pool address", 42, "l"],
            ["Token symbol", 30, "l"],
            ["Token price (CFLR)", 12, "r"],
            ["Collateral (CFLR)", 12, "r"],
            [`Fees (${fassetSymbol})`, 12, "r"],
            ["CR", 8, "r"],
        ]);
        printer.printHeader();
        let loggedAgents = ``;
        for (const agent of agents) {
            const info = await this.context.assetManager.getAgentInfo(agent.agentVault);
            const pool = await CollateralPool.at(info.collateralPool);
            const poolToken = await IERC20Metadata.at(await pool.poolToken());
            const tokenSymbol = await poolToken.symbol();
            const collateral = Number(info.totalPoolCollateralNATWei) / 10 ** 18;
            const poolTokenSupply = Number(await poolToken.totalSupply()) / 10 ** 18;
            const tokenPrice = poolTokenSupply === 0 ? 1 : collateral / poolTokenSupply;
            const fees = Number(await pool.totalFAssetFees()) / Number(settings.assetUnitUBA);
            const cr = Number(info.poolCollateralRatioBIPS) / MAX_BIPS;
            const priceDisp = `${tokenPrice.toPrecision(5)}`;
            const collateralDisp = `${collateral.toFixed(2)}`;
            const feesDisp = `${fees.toFixed(2)}`;
            const crDisp = cr < 1000 ? cr.toPrecision(5) : "-";
            const line = printer.line(pool.address, tokenSymbol, priceDisp, collateralDisp, feesDisp, crDisp);
            console.log(line);
            loggedAgents += `InfoBot fetched pool: ${line}\n`;
        }
        logger.info(loggedAgents);
        logger.info(`InfoBot finished fetching pools.`);
    }

    async printAllAgents() {
        const printer = new ColumnPrinter([
            ["Vault address", 42, "l"],
            ["Owner address", 42, "l"],
            ["Minted lots", 12, "r"],
            ["Free lots", 12, "r"],
            ["Public", 6, "r"],
        ]);
        printer.printHeader();
        const allAgents = await this.getAllAgents();
        const lotSizeUBA = await this.getLotSize();
        for (const vaultAddr of allAgents) {
            const info = await this.context.assetManager.getAgentInfo(vaultAddr);
            const mintedLots = Number(info.mintedUBA) / lotSizeUBA;
            const freeLots = Number(info.freeCollateralLots);
            const available = info.publiclyAvailable ? "YES" : "no";
            printer.printLine(vaultAddr, info.ownerManagementAddress, mintedLots.toFixed(2), freeLots.toFixed(0), available);
        }
    }

    async findPoolBySymbol(symbol: string) {
        const agents = await this.getAvailableAgents();
        for (const agent of agents) {
            const info = await this.context.assetManager.getAgentInfo(agent.agentVault);
            const pool = await CollateralPool.at(info.collateralPool);
            const poolToken = await IERC20Metadata.at(await pool.poolToken());
            const tokenSymbol = await poolToken.symbol();
            if (tokenSymbol === symbol) {
                return pool.address;
            }
        }
        throw new CommandLineError(`Pool with token symbol ${symbol} does not exist.`);
    }

    async printPoolTokenBalance(address: string) {
        const agents = await this.getAvailableAgents();
        const printer = new ColumnPrinter([
            ["Pool address", 42, "l"],
            ["Token symbol", 30, "l"],
            ["Pool tokens", 12, "r"],
        ]);
        printer.printHeader();
        for (const agent of agents) {
            const info = await this.context.assetManager.getAgentInfo(agent.agentVault);
            const pool = await CollateralPool.at(info.collateralPool);
            const poolToken = await IERC20Metadata.at(await pool.poolToken());
            const balance = await poolToken.balanceOf(address);
            const balanceNum = Number(balance) / 1e18;
            if (!balance.isZero()) {
                printer.printLine(pool.address, await poolToken.symbol(), balanceNum.toFixed(2));
            }
        }
    }

    async getPoolTokenBalance(poolAddress: string, address: string) {
        const pool = await CollateralPool.at(poolAddress);
        const poolToken = await IERC20Metadata.at(await pool.poolToken());
        return await poolToken.balanceOf(address);
    }

    private async getLotSize(settings?: AssetManagerSettings) {
        settings ??= await this.context.assetManager.getSettings();
        return Number(settings.lotSizeAMG) * Number(settings.assetMintingGranularityUBA);
    }

    async printAgentInfo(vaultAddress: string) {
        await printAgentInfo(vaultAddress, this.context);
    }
}

type ColumnType = [title: string, width: number, align: "l" | "r"];

export class ColumnPrinter {
    constructor(
        public columns: ColumnType[],
        public separator: string = "  "
    ) {
        for (const ct of this.columns) {
            ct[1] = Math.max(ct[1], ct[0].length);
        }
    }

    line(...items: string[]) {
        const chunks = this.columns.map(([_, width, align], ind) => (align === "l" ? items[ind].padEnd(width) : items[ind].padStart(width)));
        return chunks.join(this.separator);
    }

    printHeader() {
        this.printLine(...this.columns.map((it) => it[0]));
    }

    printLine(...items: string[]) {
        console.log(this.line(...items));
    }
}
