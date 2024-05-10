import BN from "bn.js";
import chalk from "chalk";
import { Secrets, createBotConfig } from "../config";
import { loadConfigFile } from "../config/config-file-loader";
import { createNativeContext } from "../config/create-asset-context";
import { IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { AgentStatus, AssetManagerSettings, AvailableAgentInfo } from "../fasset/AssetManagerTypes";
import { CommandLineError, assertNotNullCmd } from "../utils/command-line-errors";
import { MAX_BIPS, firstValue, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";

// This key is only for fetching info from the chain; don't ever use it or send any tokens to it!
const INFO_ACCOUNT_KEY = "0x4a2cc8e041ff98ef4daad2e5e4c1c3f3d5899cf9d0d321b1243e0940d8281c33";

const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const IERC20Metadata = artifacts.require("IERC20Metadata");

export class InfoBotCommands {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetNativeChainContext,
    ) {}

    /**
     * Creates instance of InfoBot.
     * @param config path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of InfoBot
     */
    static async create(secretsFile: string, configFile: string, fAssetSymbol: string | undefined): Promise<InfoBotCommands> {
        logger.info(`InfoBot started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        const secrets = Secrets.load(secretsFile);
        const config = loadConfigFile(configFile, `InfoBot`);
        // init web3 and accounts
        const apiKey = secrets.optional("apiKey.native_rpc");
        await initWeb3(authenticatedHttpProvider(config.rpcUrl, apiKey), [INFO_ACCOUNT_KEY], null);
        const botConfig = await createBotConfig("common", secrets, config);
        // create config
        const chainConfig = fAssetSymbol ? botConfig.fAssets.get(fAssetSymbol) : firstValue(botConfig.fAssets);
        assertNotNullCmd(chainConfig, `FAsset "${fAssetSymbol}" does not exist`);
        const context = await createNativeContext(botConfig, chainConfig);
        // done
        logger.info(`InfoBot successfully finished initializing cli environment.`);
        console.error(chalk.cyan("Environment successfully initialized."));
        return new InfoBotCommands(context);
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
            const line = printer.line(agent.agentVault, lots, fee.toFixed(2) + "%");
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
        const fAsset = this.context.fAsset;
        const assetManager = this.context.assetManager;
        const settings = await assetManager.getSettings();
        const lotSizeUBA = Number(settings.lotSizeAMG) * Number(settings.assetMintingGranularityUBA);
        const symbol = await fAsset.symbol();
        const info = await assetManager.getAgentInfo(vaultAddress);
        const vaultCollateral = await IERC20Metadata.at(info.vaultCollateralToken);
        const [vcSymbol, vcDec] = [await vaultCollateral.symbol(), await vaultCollateral.decimals()];
        const pool = await CollateralPool.at(info.collateralPool);
        const poolToken = await CollateralPoolToken.at(await pool.poolToken());
        const poolTokenSymbol = await poolToken.symbol();
        console.log(`collateralPoolToken: ${poolTokenSymbol}  (${poolToken.address})`);
        for (const [key, value] of Object.entries(info)) {
            if (typeof key === "number" || /^\d+$/.test(key)) continue;
            if (key === "status") {
                /* istanbul ignore next */
                console.log(`${key}: ${AgentStatus[Number(value)] ?? value}`);
            } else if (/UBA$/i.test(key)) {
                const amount = Number(value) / Number(settings.assetUnitUBA);
                const lots = Number(value) / lotSizeUBA;
                console.log(`${key.slice(0, key.length - 3)}: ${amount.toFixed(2)} ${symbol}  (${lots.toFixed(2)} lots)`);
            } else if (/RatioBIPS$/i.test(key)) {
                const amount = Number(value) / 10000;
                console.log(`${key.slice(0, key.length - 4)}: ${amount.toFixed(3)}`);
            } else if (/BIPS$/i.test(key)) {
                const percent = Number(value) / 100;
                console.log(`${key.slice(0, key.length - 4)}: ${percent.toFixed(2)}%`);
            } else if (/NATWei$/i.test(key)) {
                const amount = Number(value) / 1e18;
                console.log(`${key.slice(0, key.length - 6)}: ${amount.toFixed(2)} NAT`);
            } else if (/Wei$/i.test(key)) {
                const [symbol, decimals] =
                    /VaultCollateral/i.test(key) ? [vcSymbol, Number(vcDec)]
                        : /PoolTokens/i.test(key) ? ["FCPT", 18]
                            : /* istanbul ignore next */["???", 18];
                const amount = Number(value) / 10 ** decimals;
                console.log(`${key.slice(0, key.length - 3)}: ${amount.toFixed(2)} ${symbol}`);
            } else {
                console.log(`${key}: ${value}`);
            }
        }
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
