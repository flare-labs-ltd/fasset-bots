import BN from "bn.js";
import chalk from "chalk";
import { Secrets, closeBotConfig, createBotConfig } from "../config";
import { loadConfigFile } from "../config/config-file-loader";
import { createAgentBotContext, isAssetAgentContext } from "../config/create-asset-context";
import { IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { OwnerAddressPair } from "../fasset/Agent";
import { AgentStatus, AssetManagerSettings, AvailableAgentInfo, CollateralClass } from "../fasset/AssetManagerTypes";
import { ERC20TokenBalance, latestBlockTimestampBN } from "../utils";
import { CommandLineError, assertCmd, assertNotNullCmd } from "../utils/command-line-errors";
import { eventOrder } from "../utils/events/common";
import { Web3ContractEventDecoder } from "../utils/events/Web3ContractEventDecoder";
import { formatFixed } from "../utils/formatting";
import { BN_ZERO, BNish, MAX_BIPS, ZERO_ADDRESS, firstValue, getOrCreateAsync, randomChoice, requireNotNull, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { TokenBalances } from "../utils/token-balances";
import { artifacts, authenticatedHttpProvider, initWeb3, web3 } from "../utils/web3";
import { AgentInfoReader, CollateralPriceCalculator } from "./AgentInfoReader";
import { ColumnPrinter } from "./ColumnPrinter";
import { CleanupRegistration } from "./UserBotCommands";

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
    static async create(secrets: Secrets, configFile: string, fAssetSymbol: string | undefined, registerCleanup?: CleanupRegistration, accounts?: string[]): Promise<InfoBotCommands> {
        logger.info(`InfoBot started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        const config = loadConfigFile(configFile, `InfoBot`);
        // init web3 and accounts
        const rpcApiKey = secrets.optional("apiKey.native_rpc")
        accounts ??= await initWeb3(authenticatedHttpProvider(config.rpcUrl, rpcApiKey), [INFO_ACCOUNT_KEY], null);
        const botConfig = await createBotConfig("user", secrets, config, accounts[0]);
        registerCleanup?.(() => closeBotConfig(botConfig));
        // create config
        const chainConfig = fAssetSymbol ? botConfig.fAssets.get(fAssetSymbol) : firstValue(botConfig.fAssets);
        assertNotNullCmd(chainConfig, `FAsset "${fAssetSymbol}" does not exist`);
        const context = await createAgentBotContext(botConfig, chainConfig);
        // done
        logger.info(`InfoBot successfully finished initializing cli environment.`);
        if (fAssetSymbol) {
            logger.info(`Asset manager controller is ${context.assetManagerController.address}, asset manager for ${fAssetSymbol} is ${context.assetManager.address}.`);
        } else {
            logger.info(`Asset manager controller is ${context.assetManagerController.address}.`);
        }
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
        let eligible = agents.filter((a) => toBN(a.freeCollateralLots).gte(minAvailableLots));
        if (eligible.length === 0) return undefined;
        eligible.sort((a, b) => toBN(a.feeBIPS).cmp(toBN(b.feeBIPS)));
        while (eligible.length > 0) {
            const lowestFee = toBN(eligible[0].feeBIPS);
            let optimal = eligible.filter((a) => toBN(a.feeBIPS).eq(lowestFee));
            while (optimal.length > 0) {
                const agentVault = requireNotNull(randomChoice(optimal)).agentVault;  // list must be nonempty
                const info = await this.context.assetManager.getAgentInfo(agentVault);
                // console.log(`agent ${agentVault} status ${info.status}`);
                if (Number(info.status) === AgentStatus.NORMAL) {
                    return agentVault;
                }
                // agent is in liquidation or something, remove it and try another
                optimal = optimal.filter(a => a.agentVault !== agentVault);
                eligible = eligible.filter(a => a.agentVault !== agentVault);
            }
        }
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
        const fassetBR = await TokenBalances.fasset(this.context);
        console.log(`FAsset: ${await fAsset.name()} (${fassetBR.symbol}) at ${fAsset.address}`);
        console.log(`Asset manager: ${assetManager.address}`);
        const mintedWei = await fassetBR.totalSupply();
        const lotSizeUBA = await this.getLotSize();
        const mintedLots = Number(mintedWei) / lotSizeUBA;
        console.log(`Lot size: ${fassetBR.format(lotSizeUBA)}`);
        console.log(`Minted: ${fassetBR.format(mintedWei)}  (${mintedLots.toFixed(6)} lots)`);
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
        const fassetSymbol = this.context.fAssetSymbol;
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
            ["Owner", 20, "l"],
            ["Owner address", 42, "l"],
            ["Collateral", 12, "l"],
            ["Minted lots", 12, "r"],
            ["Free lots", 12, "r"],
            ["Minting fee", 12, "r"],
            ["Public", 6, "l"],
            ["Status", 16, "l"],
        ]);
        printer.printHeader();
        const allAgents = await this.getAllAgents();
        const lotSizeUBA = await this.getLotSize();
        const collateralTokens = new Map<string, string>();
        let countAll = 0;
        let countPublic = 0;
        let totalMinted = 0;
        let totalfreeLots = 0;
        for (const vaultAddr of allAgents) {
            const info = await this.context.assetManager.getAgentInfo(vaultAddr);
            const ownerName = await this.context.agentOwnerRegistry.getAgentName(info.ownerManagementAddress);
            const collateral = await getOrCreateAsync(collateralTokens, info.vaultCollateralToken, async (tokenAddr) => {
                const collateralType = await this.context.assetManager.getCollateralType(CollateralClass.VAULT, tokenAddr);
                const tokenBR = await TokenBalances.collateralType(collateralType);
                let name = tokenBR.symbol;
                if (toBN(collateralType.validUntil).gt(BN_ZERO)) {
                    const ts = toBN(collateralType.validUntil).lt(await latestBlockTimestampBN()) ? "i" : "d";
                    name = `[${ts}] ${name}`;
                }
                return name;
            });
            const mintedLots = Number(info.mintedUBA) / lotSizeUBA;
            const freeLots = Number(info.freeCollateralLots);
            const available = info.publiclyAvailable ? "YES" : "no";
            const status = AgentStatus[Number(info.status)];
            const mintedFee = Number(info.feeBIPS) / 100;
            printer.printLine(vaultAddr, ownerName.slice(0, 20), info.ownerManagementAddress,
                collateral.slice(0, 12), mintedLots.toFixed(2), freeLots.toFixed(0), mintedFee.toFixed(2), available, status);
            ++countAll;
            totalMinted += mintedLots;
            if (info.publiclyAvailable && status === "NORMAL") {
                ++countPublic;
                totalfreeLots += freeLots;
            }
        }
        console.log(`Total agents: ${countAll},  available for minting: ${countPublic}`);
        console.log(`Total minted lots: ${totalMinted.toFixed(2)},  total free lots: ${totalfreeLots.toFixed(0)}`);
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

    async getLotSize(settings?: AssetManagerSettings) {
        settings ??= await this.context.assetManager.getSettings();
        return Number(settings.lotSizeAMG) * Number(settings.assetMintingGranularityUBA);
    }

    async getLotSizeBN(settings?: AssetManagerSettings) {
        settings ??= await this.context.assetManager.getSettings();
        return toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
    }

    /**
     * Get agent info (raw output of getAgentInfo contract method)
     * @param agentVault agent's vault address
     */
    async printRawAgentInfo(vaultAddress: string) {
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

    /**
     * Get agent info (nicely formatted, with info about underlying and owner addresses)
     * @param agentVault agent's vault address
     */
    async printAgentInfo(vaultAddress: string, owner?: OwnerAddressPair, ownerUnderlyingAddress?: string) {
        assertCmd(isAssetAgentContext(this.context), "Cannot use printAgentInfo for this setup");
        function formatBackedAmount(amountUBA: BNish) {
            const lots = toBN(amountUBA).div(air.lotSizeUBA());
            return `${fassetBR.format(amountUBA)}  (${lots} lots)`;
        }
        function formatCR(bips: BNish) {
            if (String(bips) === "10000000000") return "<inf>";
            return formatFixed(toBN(bips), 4);
        }
        function formatCollateral(cpr: CollateralPriceCalculator, amount: BNish) {
            const lots = toBN(amount).div(cpr.mintingCollateralRequired(air.lotSizeUBA()));
            return `${cpr.balanceReader.format(amount)}  (${lots} lots)`;
        }
        async function formatCollateralAt(cpr: CollateralPriceCalculator, address: string) {
            return formatCollateral(cpr, await cpr.balanceReader.balance(address));
        }
        /* istanbul ignore next */
        function formatAgentStatus(status: AgentStatus) {
            switch (status) {
                case AgentStatus.NORMAL: return `healthy`;
                case AgentStatus.CCB: return `in collateral call band`;
                case AgentStatus.LIQUIDATION: return `in liquidation`;
                case AgentStatus.FULL_LIQUIDATION: return `in full liquidation`;
                case AgentStatus.DESTROYING: return `closing`;
            }
        }
        //
        // const fAsset = this.context.fAsset;
        const assetManager = this.context.assetManager;
        const air = await AgentInfoReader.create(assetManager, vaultAddress);
        const agentInfo = air.info;
        const collateralPool = await CollateralPool.at(agentInfo.collateralPool);
        // baalnce reader
        const nativeBR = await TokenBalances.evmNative(this.context);
        const fassetBR = await TokenBalances.fasset(this.context);
        const underlyingBR = await TokenBalances.fassetUnderlyingToken(this.context);
        const vaultBR = air.vaultCollateral.balanceReader;
        const poolBR = air.poolCollateral.balanceReader;
        const poolTokenBR = air.poolTokenBalanceReader;
        //
        const poolNativeCollateral = new CollateralPriceCalculator(agentInfo, air.poolCollateral.price, nativeBR, ZERO_ADDRESS);
        //
        console.log("Tokens:");
        console.log(`    Native token: ${nativeBR.symbol}`);
        console.log(`    Wrapped native token: ${air.poolCollateral.currency.symbol}`);
        console.log(`    FAsset token: ${fassetBR.symbol}`);
        console.log(`    Underlying token: ${underlyingBR.symbol}`);
        console.log(`    Vault collateral token: ${air.vaultCollateral.currency.symbol}`);
        console.log(`    Collateral pool token: ${poolTokenBR.symbol}`);
        //
        console.log("Network exchange rates:");
        console.log(`    ${nativeBR.symbol}/USD: ${air.poolCollateral.price.tokenPrice?.format()}`);
        console.log(`    ${vaultBR.symbol}/USD: ${air.vaultCollateral.price.tokenPrice?.format()}`);
        console.log(`    ${underlyingBR.symbol}/USD: ${air.poolCollateral.price.assetPrice?.format()}`);
        //
        console.log("Agent mint and collateral:");
        console.log(`    Status: ${formatAgentStatus(Number(agentInfo.status))}`);
        console.log(`    Public: ${agentInfo.publiclyAvailable}`);
        console.log(`    Free lots: ${agentInfo.freeCollateralLots}`);
        console.log(`    Minted: ${formatBackedAmount(agentInfo.mintedUBA)}`);
        console.log(`    Reserved: ${formatBackedAmount(agentInfo.reservedUBA)}`);
        console.log(`    Redeeming: ${formatBackedAmount(agentInfo.redeemingUBA)}`);
        console.log(`    Vault CR: ${formatCR(agentInfo.vaultCollateralRatioBIPS)}  ` +
            `(minCR=${formatCR(air.vaultCollateral.minCRBips())}, mintingCR=${formatCR(air.vaultCollateral.mintingCRBips())})`);
        console.log(`    Pool CR: ${formatCR(agentInfo.poolCollateralRatioBIPS)}  ` +
            `(minCR=${formatCR(air.poolCollateral.minCRBips())}, mintingCR=${formatCR(air.poolCollateral.mintingCRBips())})`);
        console.log(`    Free vault collateral: ${formatCollateral(air.vaultCollateral, agentInfo.freeVaultCollateralWei)}`);
        console.log(`    Free pool collateral: ${formatCollateral(air.poolCollateral, agentInfo.freePoolCollateralNATWei)}`);
        //
        console.log("Lots:");
        const lotSizeUBA = air.lotSizeUBA();
        console.log(`    Lot size: ${underlyingBR.format(lotSizeUBA)}`);
        console.log(`    Lot vault collateral: ${vaultBR.format(air.vaultCollateral.mintingCollateralRequired(lotSizeUBA))}`);
        console.log(`    Lot pool collateral: ${nativeBR.format(air.poolCollateral.mintingCollateralRequired(lotSizeUBA))}`);
        //
        console.log(`Agent address (vault): ${vaultAddress}`);
        console.log(`    Vault collateral balance: ${await vaultBR.formatBalance(vaultAddress)}`);
        console.log(`    Pool tokens balance: ${await poolTokenBR.formatBalance(vaultAddress)}`);
        console.log(`    Pool fee share: ${fassetBR.format(await collateralPool.fAssetFeesOf(vaultAddress))}`);
        console.log(`Agent collateral pool: ${agentInfo.collateralPool}`);
        console.log(`    Collateral balance: ${await poolBR.formatBalance(agentInfo.collateralPool)}`);
        console.log(`    Total pool token supply: ${poolTokenBR.format(await (poolTokenBR as ERC20TokenBalance).totalSupply())}`);
        console.log(`    Total collected fees: ${await fassetBR.formatBalance(agentInfo.collateralPool)}`);
        // vault underlying
        console.log(`Agent vault underlying (${underlyingBR.symbol}) address: ${agentInfo.underlyingAddressString}`);
        console.log(`    Actual balance: ${await underlyingBR.formatBalance(agentInfo.underlyingAddressString)}`);
        console.log(`    Tracked balance: ${underlyingBR.format(toBN(agentInfo.underlyingBalanceUBA))}`);
        console.log(`    Required balance: ${underlyingBR.format(toBN(agentInfo.requiredUnderlyingBalanceUBA))}`);
        console.log(`    Free balance: ${underlyingBR.format(toBN(agentInfo.freeUnderlyingBalanceUBA))}`);
        // data for agent owner
        if (owner && ownerUnderlyingAddress) {
            if (owner.managementAddress === agentInfo.ownerManagementAddress) {
                console.log(`Agent owner management address: ${agentInfo.ownerManagementAddress}`);
                console.log(`    Balance: ${await nativeBR.formatBalance(agentInfo.ownerManagementAddress)}`);
                console.log(`    Balance: ${await vaultBR.formatBalance(agentInfo.ownerManagementAddress)}`);
                //
                console.log(`Agent owner work address: ${agentInfo.ownerWorkAddress}`);
                console.log(`    Balance: ${await formatCollateralAt(poolNativeCollateral, agentInfo.ownerWorkAddress)}`);
                console.log(`    Balance: ${await formatCollateralAt(air.vaultCollateral, agentInfo.ownerWorkAddress)}`);
                //
                console.log(`Agent owner underlying (${underlyingBR.symbol}) address: ${ownerUnderlyingAddress}`);
                console.log(`    Balance: ${await underlyingBR.formatBalance(ownerUnderlyingAddress)}`);
            } else {
                console.log(`Agent vault owned by agent owner with management address ${agentInfo.ownerManagementAddress}`);
            }
        }
    }
    /* istanbul ignore next */
    async* readAssetManagerLogs(blockCount: number) {
        const eventDecoder = new Web3ContractEventDecoder({ assetManager: this.context.assetManager });
        // get all logs for this agent
        const nci = this.context.nativeChainInfo;
        const blockHeight = await web3.eth.getBlockNumber();
        const lastFinalizedBlock = blockHeight - nci.finalizationBlocks;
        const startBlock = Math.max(lastFinalizedBlock - blockCount, 0);
        for (let lastBlockRead = startBlock; lastBlockRead <= lastFinalizedBlock; lastBlockRead += nci.readLogsChunkSize) {
            // asset manager events
            const logsAssetManager = await web3.eth.getPastLogs({
                address: this.context.assetManager.address,
                fromBlock: lastBlockRead,
                toBlock: Math.min(lastBlockRead + nci.readLogsChunkSize - 1, lastFinalizedBlock),
            });
            const events = eventDecoder.decodeEvents(logsAssetManager);
            // sort events first by their block numbers, then internally by their event index
            events.sort(eventOrder);
            for (const event of events) {
                yield event;
            }
        }
    }
}
