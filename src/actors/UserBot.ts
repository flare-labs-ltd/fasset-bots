import chalk from "chalk";
import { BotConfig, createBotConfig, loadAgentConfigFile } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { AvailableAgentInfo } from "../fasset/AssetManagerTypes";
import { Minter } from "../mock/Minter";
import { Redeemer } from "../mock/Redeemer";
import { printAgentInfo, proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { BNish, CommandLineError, toBN } from "../utils/helpers";
import { requireSecret } from "../config/secrets";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { PaymentReference } from "../fasset/PaymentReference";
import { logger } from "../utils/logger";
import { web3DeepNormalize } from "../utils/web3normalize";
import { formatArgs } from "../utils/formatting";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { getSecrets } from "../config/secrets";

export class UserBot {
    context!: IAssetAgentBotContext;
    botConfig!: BotConfig;
    nativeAddress!: string;
    underlyingAddress!: string;

    /**
     * Creates instance of UserBot.
     * @param config path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of UserBot
     */
    static async create(configFile: string, fAssetSymbol: string): Promise<UserBot> {
        const bot = new UserBot();
        await bot.initialize(configFile, fAssetSymbol);
        return bot;
    }

    /**
     * Initializes asset context from AgentBotRunConfig.
     * @param configFile path to configuration file
     * @param fAssetSymbol symbol for the fasset
     */
    async initialize(configFile: string, fAssetSymbol: string): Promise<void> {
        logger.info(`User ${requireSecret("user.native_address")} started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        const runConfig = loadAgentConfigFile(configFile, `User ${requireSecret("user.native_address")}`);
        // init web3 and accounts
        this.nativeAddress = requireSecret("user.native_address");
        const nativePrivateKey = requireSecret("user.native_private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [nativePrivateKey], null);
        /* istanbul ignore next */
        if (this.nativeAddress !== accounts[0]) {
            logger.error(`User ${requireSecret("user.native_address")} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        this.botConfig = await createBotConfig(runConfig, this.nativeAddress);
        const chainConfig = this.botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) {
            logger.error(`User ${requireSecret("user.native_address")} has invalid FAsset symbol.`);
            throw new CommandLineError("Invalid FAsset symbol");
        }
        this.context = await createAssetContext(this.botConfig, chainConfig);
        // create underlying wallet key
        this.underlyingAddress = requireSecret("user.underlying_address");
        const underlyingPrivateKey = requireSecret("user.underlying_private_key");
        await this.context.wallet.addExistingAccount(this.underlyingAddress, underlyingPrivateKey);
        console.error(chalk.cyan("Environment successfully initialized."));
        logger.info(`User ${requireSecret("user.native_address")} successfully finished initializing cli environment.`);
    }

    /**
     * Updates underlying block and timestamp on fasset contracts.
     */
    async updateUnderlyingTime() {
        logger.info(`User ${requireSecret("user.native_address")} started updating underlying block time.`);
        console.log("Updating underlying block time....");
        await proveAndUpdateUnderlyingBlock(this.context.attestationProvider, this.context.assetManager, this.nativeAddress);
        logger.info(`User ${requireSecret("user.native_address")} finished updating underlying block time.`);
    }

    /**
     * Gets available agents.
     * @returns list of objects AvailableAgentInfo
     */
    async getAvailableAgents(): Promise<AvailableAgentInfo[]> {
        const result: AvailableAgentInfo[] = [];
        const chunkSize = 10;
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
    async getAllAgents(): Promise<string[]> {
        const result: string[] = [];
        const chunkSize = 10;
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

    /**
     * Mints desired amount of lots against desired agent.
     * @param agentVault agent's vault address
     * @param lots number of lots to mint
     */
    async mint(agentVault: string, lots: BNish): Promise<void> {
        logger.info(`User ${requireSecret("user.native_address")} started minting with agent ${agentVault}.`);
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Reserving collateral...");
        logger.info(`User ${requireSecret("user.native_address")} is reserving collateral with agent ${agentVault} and ${lots} lots.`);
        const crt = await minter.reserveCollateral(agentVault, lots);
        logger.info(`User ${requireSecret("user.native_address")} reserved collateral ${formatArgs(crt)} with agent ${agentVault} and ${lots} lots.`);
        console.log(`Paying on the underlying chain for reservation ${crt.collateralReservationId} to address ${crt.paymentAddress}...`);
        logger.info(
            `User ${requireSecret("user.native_address")} is paying on underlying chain for reservation ${
                crt.collateralReservationId
            } to agent's ${agentVault} address ${crt.paymentAddress}.`
        );
        const txHash = await minter.performMintingPayment(crt);
        logger.info(
            `User ${requireSecret("user.native_address")} paid on underlying chain for reservation ${
                crt.collateralReservationId
            } to agent's ${agentVault} with transaction ${txHash}.`
        );
        await this.proveAndExecuteMinting(crt.collateralReservationId, txHash, crt.paymentAddress);
        logger.info(`User ${requireSecret("user.native_address")} finished minting with agent ${agentVault}.`);
    }

    /**
     * Proves minting payment and executes minting.
     * @param collateralReservationId collateral reservation id
     * @param transactionHash transaction hash of minting payment
     * @param paymentAddress agent's underlying address
     */
    async proveAndExecuteMinting(collateralReservationId: BNish, transactionHash: string, paymentAddress: string): Promise<void> {
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Waiting for transaction finalization...");
        logger.info(
            `User ${requireSecret(
                "user.native_address"
            )} is waiting for transaction ${transactionHash} finalization for reservation ${collateralReservationId}.`
        );
        await minter.waitForTransactionFinalization(transactionHash);
        console.log(`Waiting for proof of underlying payment transaction ${transactionHash}...`);
        logger.info(
            `User ${requireSecret(
                "user.native_address"
            )} is waiting for proof of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
        const proof = await minter.proveMintingPayment(paymentAddress, transactionHash);
        console.log(`Executing payment...`);
        logger.info(
            `User ${requireSecret("user.native_address")} is executing minting with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
        await minter.executeProvedMinting(collateralReservationId, proof);
        console.log("Done");
        logger.info(
            `User ${requireSecret("user.native_address")} executed minting with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
    }

    /**
     * Redeems desired amount of lots.
     * @param lots number of lots to redeem
     */
    async redeem(lots: BNish) {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        console.log(`Asking for redemption of ${lots} lots`);
        logger.info(`User ${requireSecret("user.native_address")} is asking for redemption of ${lots} lots.`);
        const [requests, remainingLots] = await redeemer.requestRedemption(lots);
        if (!toBN(remainingLots).isZero()) {
            console.log(
                `Maximum number of redeemed tickets exceeded. ${remainingLots} lots have remained unredeemed. You can execute redeem again until all are redeemed.`
            );
            logger.info(
                `User ${requireSecret("user.native_address")} exceeded maximum number of redeemed tickets. ${remainingLots} lots have remained unredeemed.`
            );
        }
        console.log(`Triggered ${requests.length} payment requests (addresses, block numbers and timestamps are on underlying chain):`);
        logger.info(`User ${requireSecret("user.native_address")} triggered ${requests.length} payment requests.`);
        let loggedRequests = ``;
        for (const req of requests) {
            const amount = toBN(req.valueUBA).sub(toBN(req.feeUBA));
            console.log(
                `    id=${req.requestId}  to=${req.paymentAddress}  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${req.lastUnderlyingBlock}  lastTimestamp=${req.lastUnderlyingTimestamp}`
            );
            loggedRequests =
                loggedRequests +
                `User ${requireSecret("user.native_address")} triggered request:    id=${req.requestId}  to=${
                    req.paymentAddress
                }  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${
                    req.lastUnderlyingBlock
                }  lastTimestamp=${req.lastUnderlyingTimestamp}\n`;
        }
        logger.info(loggedRequests);
    }

    /**
     * Calls redemption default after proving underlying non payment for redemption.
     * @param amountUBA amount to be paid in redemption
     * @param paymentReference payment reference to be used in redemption
     * @param firstUnderlyingBlock underlying block in which redemption request was created
     * @param lastUnderlyingBlock last underlying block within payment performed
     * @param lastUnderlyingTimestamp last underlying timestamp within payment performed
     */
    async redemptionDefault(
        amountUBA: BNish,
        paymentReference: string,
        firstUnderlyingBlock: BNish,
        lastUnderlyingBlock: BNish,
        lastUnderlyingTimestamp: BNish
    ) {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        const requestId = PaymentReference.decodeId(paymentReference);
        logger.info(`User ${requireSecret("user.native_address")} is defaulting redemption ${requestId}.`);
        if (paymentReference !== PaymentReference.redemption(requestId)) {
            logger.error(`User ${requireSecret("user.native_address")} provided invalid payment reference ${paymentReference} for redemption ${requestId}.`);
            throw new CommandLineError("Invalid payment reference");
        }
        console.log("Waiting for payment default proof...");
        logger.info(`User ${requireSecret("user.native_address")} is waiting for proof of underlying non payment for redemption ${requestId}.`);
        const proof = await redeemer.obtainNonPaymentProof(
            this.underlyingAddress,
            paymentReference,
            amountUBA,
            firstUnderlyingBlock,
            lastUnderlyingBlock,
            lastUnderlyingTimestamp
        );
        console.log("Executing payment default...");
        logger.info(
            `User ${requireSecret("user.native_address")} is executing payment default with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} redemption ${requestId}.`
        );
        await redeemer.executePaymentDefault(requestId, proof);
        console.log("Done");
        logger.info(
            `User ${requireSecret("user.native_address")} executed payment default with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} redemption ${requestId}.`
        );
    }

    async printSystemInfo(agents: boolean) {
        const fAsset = this.context.fAsset;
        const assetManager = this.context.assetManager;
        const settings = await assetManager.getSettings();
        const symbol = await fAsset.symbol();
        console.log(`FAsset: ${await fAsset.name()} (${symbol}) at ${fAsset.address}`);
        console.log(`Asset manager: ${assetManager.address}`);
        const mintedWei = await fAsset.totalSupply();
        const minted = Number(mintedWei) / Number(settings.assetUnitUBA);
        const lotSizeUBA = Number(settings.lotSizeAMG) * Number(settings.assetMintingGranularityUBA);
        const mintedLots = Number(mintedWei) / lotSizeUBA;
        console.log(`Minted: ${minted.toFixed(2)} ${symbol}  (${mintedLots.toFixed(2)} lots)`);
        if (agents) {
            await this.printAgentList(lotSizeUBA);
        }
    }

    private async printAgentList(lotSizeUBA: number) {
        console.log("-------------- Agents --------------");
        console.log(`${"Vault address".padEnd(42)}  ${"Owner address".padEnd(42)}  ${"Minted lots".padStart(12)}  ${"Free lots".padStart(12)}  ${"Public"}`);
        const allAgents = await this.getAllAgents();
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

    async printAgentInfo(vaultAddress: string) {
        await printAgentInfo(vaultAddress, this.context);
    }
}
