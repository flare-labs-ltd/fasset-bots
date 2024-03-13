import BN from "bn.js";
import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";
import { BotConfig, BotFAssetConfig, createBotConfig, decodedChainId, loadAgentConfigFile } from "../config/BotConfig";
import { BotConfigFile } from "../config/config-files";
import { createAssetContext } from "../config/create-asset-context";
import { getSecrets, requireSecret } from "../config/secrets";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { PaymentReference } from "../fasset/PaymentReference";
import { Minter } from "../mock/Minter";
import { Redeemer } from "../mock/Redeemer";
import { requiredEventArgs } from "../utils/events/truffle";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { formatArgs } from "../utils/formatting";
import { BNish, CommandLineError, ZERO_ADDRESS, requireNotNull, sumBN, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { web3DeepNormalize } from "../utils/web3normalize";
import { InfoBot } from "./InfoBot";
import { AssetManagerSettings, TokenExitType } from "../fasset/AssetManagerTypes";
import { latestBlockTimestamp } from "../utils/web3helpers";
import { loadContracts } from "../config";

/* istanbul ignore next */
const USER_DATA_DIR = process.env.FASSET_USER_DATA_DIR ?? path.resolve(os.homedir(), "fasset");

const CollateralPool = artifacts.require("CollateralPool");

interface MintData {
    type: "mint";
    requestId: string;
    transactionHash: string;
    paymentAddress: string;
    executorAddress: string;
    createdAt: string;
}

interface RedeemData {
    type: "redeem";
    requestId: string;
    amountUBA: string;
    paymentReference: string;
    firstUnderlyingBlock: string;
    lastUnderlyingBlock: string;
    lastUnderlyingTimestamp: string;
    executorAddress: string;
    createdAt: string;
}

type StateData = MintData | RedeemData;

enum RedemptionStatus {
    EXPIRED = "EXPIRED",
    SUCCESS = "SUCCESS",
    DEFAULT = "DEFAULT",
    PENDING = "PENDING",
}

enum MintingStatus {
    EXPIRED = "EXPIRED",
    PENDING = "PENDING",
}

export class UserBot {
    context!: IAssetAgentBotContext;
    configFile!: BotConfigFile;
    botConfig!: BotConfig;
    fassetConfig!: BotFAssetConfig;
    nativeAddress!: string;
    underlyingAddress!: string;

    static userDataDir: string = USER_DATA_DIR;

    /**
     * Creates instance of UserBot.
     * @param config path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of UserBot
     */
    static async create(configFile: string, fAssetSymbol: string, requireWallet: boolean): Promise<UserBot> {
        const bot = new UserBot();
        await bot.initialize(configFile, fAssetSymbol, requireWallet);
        return bot;
    }

    /**
     * Initializes asset context from AgentBotRunConfig.
     * @param configFile path to configuration file
     * @param fAssetSymbol symbol for the fasset
     */
    async initialize(configFile: string, fAssetSymbol: string, requireWallet: boolean): Promise<void> {
        this.nativeAddress = requireSecret("user.native.address");
        logger.info(`User ${this.nativeAddress} started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        this.configFile = loadAgentConfigFile(configFile, `User ${this.nativeAddress}`);
        // init web3 and accounts
        const nativePrivateKey = requireSecret("user.native.private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(this.configFile.rpcUrl, getSecrets().apiKey.native_rpc), [nativePrivateKey], null);
        /* istanbul ignore next */
        if (!accounts.includes(this.nativeAddress)) {
            logger.error(`User ${this.nativeAddress} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        this.botConfig = await createBotConfig(this.configFile, this.nativeAddress);
        const chainConfig = this.botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) {
            logger.error(`User ${this.nativeAddress} has invalid FAsset symbol.`);
            throw new CommandLineError("Invalid FAsset symbol");
        }
        this.context = await createAssetContext(this.botConfig, chainConfig);
        this.fassetConfig = chainConfig;
        // create underlying wallet key
        if (requireWallet) {
            const chainName = decodedChainId(this.fassetConfig.chainInfo.chainId);
            const underlyingAddress = requireSecret(`user.${chainName}.address`);
            this.underlyingAddress = await this.validateUnderlyingAddress(underlyingAddress);
            const underlyingPrivateKey = requireSecret(`user.${chainName}.private_key`);
            await this.context.wallet.addExistingAccount(this.underlyingAddress, underlyingPrivateKey);
        }
        console.error(chalk.cyan("Environment successfully initialized."));
        logger.info(`User ${this.nativeAddress} successfully finished initializing cli environment.`);
    }

    // User must make sure that underlying address is valid and normalized.
    // Otherwise the agent will reject the redemption and the user will lose the fasset value.
    async validateUnderlyingAddress(underlyingAddress: string) {
        const res = await this.fassetConfig.verificationClient!.checkAddressValidity(this.fassetConfig.chainInfo.chainId, underlyingAddress);
        if (!res.isValid) {
            logger.error(`User ${this.nativeAddress} has invalid underlying address.`);
            throw new CommandLineError("Invalid underlying address");
        }
        return res.standardAddress;
    }

    infoBot(): InfoBot {
        const fassetInfo = requireNotNull(this.configFile.fAssetInfos.find((cc) => cc.fAssetSymbol === this.fassetConfig.fAssetSymbol));
        return new InfoBot(this.context, this.configFile, fassetInfo);
    }

    /**
     * Updates underlying block and timestamp on fasset contracts.
     */
    async updateUnderlyingTime(): Promise<void> {
        logger.info(`User ${this.nativeAddress} started updating underlying block time.`);
        console.log("Updating underlying block time....");
        await proveAndUpdateUnderlyingBlock(this.context.attestationProvider, this.context.assetManager, this.nativeAddress);
        logger.info(`User ${this.nativeAddress} finished updating underlying block time.`);
    }

    /**
     * Mints desired amount of lots against desired agent.
     * @param agentVault agent's vault address
     * @param lots number of lots to mint
     * @param executorAddress
     * @param executorFeeNatWei
     */
    async reserveCollateral(agentVault: string, lots: BNish, executorAddress: string, executorFeeNatWei?: BNish): Promise<BN> {
        logger.info(`User ${this.nativeAddress} started minting with agent ${agentVault}.`);
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Reserving collateral...");
        logger.info(`User ${this.nativeAddress} is reserving collateral with agent ${agentVault} and ${lots} lots.`);
        const crt = await minter.reserveCollateral(agentVault, lots, executorAddress, executorFeeNatWei);
        logger.info(`User ${this.nativeAddress} reserved collateral ${formatArgs(crt)} with agent ${agentVault} and ${lots} lots.`);
        console.log(`Paying on the underlying chain for reservation ${crt.collateralReservationId} to address ${crt.paymentAddress}...`);
        logger.info(
            `User ${this.nativeAddress} is paying on underlying chain for reservation ${crt.collateralReservationId} to agent's ${agentVault} address ${crt.paymentAddress}.`
        );
        const txHash = await minter.performMintingPayment(crt);
        const timestamp = await latestBlockTimestamp();
        const state: MintData = {
            type: "mint",
            requestId: String(crt.collateralReservationId),
            paymentAddress: crt.paymentAddress,
            transactionHash: txHash,
            executorAddress: executorAddress,
            createdAt: this.timestampToDateString(timestamp),
        };
        this.writeState(state);
        logger.info(
            `User ${this.nativeAddress} paid on underlying chain for reservation ${crt.collateralReservationId} to agent's ${agentVault} with transaction ${txHash}.`
        );
        return crt.collateralReservationId;
    }


    /**
     * Mints desired amount of lots against desired agent.
     * @param agentVault agent's vault address
     * @param lots number of lots to mint
     * @param executorAddress optional address of the executor
     * @param executorFeeNatWei optional executor fee (required if executor is used)
     */
    async mint(agentVault: string, lots: BNish, noWait: boolean, executorAddress: string = ZERO_ADDRESS, executorFeeNatWei?: BNish): Promise<void> {
        const requestId = await this.reserveCollateral(agentVault, lots, executorAddress, executorFeeNatWei);
        if (noWait) {
            console.log(`The minting started and must be executed later by running "user-bot mintExecute ${requestId}".`);
            if (executorAddress !== ZERO_ADDRESS) {
                console.log("The minting can also be executed by the executor. Please pass the executor the state file:");
                console.log("    " + this.stateFilePath("mint", requestId));
            }
            logger.info(`User ${this.nativeAddress} didn't wait for minting with agent ${agentVault}.`);
            return;
        }
        if (executorAddress !== ZERO_ADDRESS) {
            console.log("If the minting fails or is interrupted, it can be executed by the executor. Please pass the executor the state file:");
            console.log("    " + this.stateFilePath("mint", requestId));
        }
        await this.proveAndExecuteSavedMinting(requestId);
        logger.info(`User ${this.nativeAddress} finished minting with agent ${agentVault}.`);
    }

    /**
     * Proves minting payment and executes minting.
     * @param requestIdOrPath minting request id or minting state file path
     */
    async proveAndExecuteSavedMinting(requestIdOrPath: BNish | string) {
        const state = this.readState("mint", requestIdOrPath);
        await this.proveAndExecuteMinting(state.requestId, state.transactionHash, state.paymentAddress);
        this.deleteState(state, requestIdOrPath);
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
        logger.info(`User ${this.nativeAddress} is waiting for transaction ${transactionHash} finalization for reservation ${collateralReservationId}.`);
        await minter.waitForTransactionFinalization(transactionHash);
        console.log(`Waiting for proof of underlying payment transaction ${transactionHash}...`);
        logger.info(
            `User ${this.nativeAddress} is waiting for proof of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
        const proof = await minter.proveMintingPayment(paymentAddress, transactionHash);
        console.log(`Executing payment...`);
        logger.info(
            `User ${this.nativeAddress} is executing minting with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
        await minter.executeProvedMinting(collateralReservationId, proof, ZERO_ADDRESS);
        console.log("Done");
        logger.info(
            `User ${this.nativeAddress} executed minting with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
    }

    async listMintings(): Promise<void> {
        const stateList = this.readStateList("mint");
        const timestamp = await latestBlockTimestamp();
        const settings = await this.context.assetManager.getSettings();
        for (const state of stateList) {
            const stateTs = this.dateStringToTimestamp(state.createdAt);
            const expired = timestamp - stateTs >= Number(settings.attestationWindowSeconds);
            console.log(`${state.requestId}  ${expired ? MintingStatus.EXPIRED : MintingStatus.PENDING}`);
        }
    }

    /**
     * Redeems desired amount of lots.
     * @param lots number of lots to redeem
     * @param executorAddress
     * @param executorFeeNatWei
     */
    async redeem(lots: BNish, executorAddress: string = ZERO_ADDRESS, executorFeeNatWei?: BNish): Promise<void> {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        console.log(`Asking for redemption of ${lots} lots`);
        logger.info(`User ${this.nativeAddress} is asking for redemption of ${lots} lots.`);
        const [requests, remainingLots] = await redeemer.requestRedemption(lots, executorAddress, executorFeeNatWei);
        if (!toBN(remainingLots).isZero()) {
            console.log(
                `Maximum number of redeemed tickets exceeded. ${remainingLots} lots have remained unredeemed. You can execute redeem again until all are redeemed.`
            );
            logger.info(`User ${this.nativeAddress} exceeded maximum number of redeemed tickets. ${remainingLots} lots have remained unredeemed.`);
        }
        console.log(`Triggered ${requests.length} payment requests (addresses, block numbers and timestamps are on underlying chain):`);
        logger.info(`User ${this.nativeAddress} triggered ${requests.length} payment requests.`);
        let loggedRequests = ``;
        const requestFiles: string[] = [];
        for (const req of requests) {
            const amount = toBN(req.valueUBA).sub(toBN(req.feeUBA));
            console.log(
                `    id=${req.requestId}  to=${req.paymentAddress}  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${req.lastUnderlyingBlock}  lastTimestamp=${req.lastUnderlyingTimestamp}`
            );
            loggedRequests =
                loggedRequests +
                `User ${this.nativeAddress} triggered request:    id=${req.requestId}  to=${req.paymentAddress}  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${req.lastUnderlyingBlock}  lastTimestamp=${req.lastUnderlyingTimestamp}\n`;
            const timestamp = await latestBlockTimestamp();
            this.writeState({
                type: "redeem",
                requestId: String(req.requestId),
                amountUBA: String(amount),
                paymentReference: req.paymentReference,
                firstUnderlyingBlock: String(req.firstUnderlyingBlock),
                lastUnderlyingBlock: String(req.lastUnderlyingBlock),
                lastUnderlyingTimestamp: String(req.lastUnderlyingTimestamp),
                executorAddress: String(req.executor),
                createdAt: this.timestampToDateString(timestamp),
            });
            requestFiles.push(this.stateFilePath("redeem", req.requestId));
        }
        if (executorAddress !== ZERO_ADDRESS) {
            console.log("In case of redemption non-payment, the default can be triggered by the executor. Please pass the executor the state file(s):");
            requestFiles.forEach(fname => console.log("    " + fname));
        }
        logger.info(loggedRequests);
    }

    /**
     * Call redemption default with saved redemption state.
     * @param requestIdOrPath redemption request id or minting state file path
     */
    async savedRedemptionDefault(requestIdOrPath: BNish | string): Promise<void> {
        const state = this.readState("redeem", requestIdOrPath);
        await this.redemptionDefault(
            state.amountUBA,
            state.paymentReference,
            state.firstUnderlyingBlock,
            state.lastUnderlyingBlock,
            state.lastUnderlyingTimestamp
        );
        this.deleteState(state, requestIdOrPath);
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
    ): Promise<void> {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        const requestId = PaymentReference.decodeId(paymentReference);
        logger.info(`User ${this.nativeAddress} is defaulting redemption ${requestId}.`);
        if (paymentReference !== PaymentReference.redemption(requestId)) {
            logger.error(`User ${this.nativeAddress} provided invalid payment reference ${paymentReference} for redemption ${requestId}.`);
            throw new CommandLineError("Invalid payment reference");
        }
        console.log("Waiting for payment default proof...");
        logger.info(`User ${this.nativeAddress} is waiting for proof of underlying non payment for redemption ${requestId}.`);
        const proof = await redeemer.obtainNonPaymentProof(
            this.underlyingAddress,
            paymentReference,
            amountUBA,
            firstUnderlyingBlock,
            lastUnderlyingBlock,
            lastUnderlyingTimestamp
        );
        console.log("Executing payment default...");
        logger.info(`User ${this.nativeAddress} is executing payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} redemption ${requestId}.`);
        await redeemer.executePaymentDefault(requestId, proof, ZERO_ADDRESS);   // executor must call from own user address
        console.log("Done");
        logger.info(`User ${this.nativeAddress} executed payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} redemption ${requestId}.`);
    }

    async listRedemptions(): Promise<void> {
        const stateList = this.readStateList("redeem");
        const timestamp = await latestBlockTimestamp();
        const settings = await this.context.assetManager.getSettings();
        for (const state of stateList) {
            const status = await this.redemptionStatus(state, timestamp, settings);
            console.log(`${state.requestId}  ${status}`);
        }
    }

    async redemptionStatus(state: RedeemData, timestamp: number, settings: AssetManagerSettings): Promise<RedemptionStatus> {
        const stateTs = this.dateStringToTimestamp(state.createdAt);
        if (timestamp - stateTs >= Number(settings.attestationWindowSeconds)) {
            return RedemptionStatus.EXPIRED;
        } else if (await this.findRedemptionPayment(state)) {
            return RedemptionStatus.SUCCESS;
        } else if (await this.redemptionTimeElapsed(state)) {
            return RedemptionStatus.DEFAULT;
        } else {
            return RedemptionStatus.PENDING;
        }
    }

    async findRedemptionPayment(state: RedeemData) {
        const txs = await this.context.blockchainIndexer.getTransactionsByReference(state.paymentReference);
        for (const tx of txs) {
            const amount = sumBN(tx.outputs.filter(o => o[0] === this.underlyingAddress), o => o[1]);
            if (amount.gte(toBN(state.amountUBA))) {
                return tx;
            }
        }
    }

    async redemptionTimeElapsed(state: RedeemData): Promise<boolean> {
        const blockHeight = await this.context.blockchainIndexer.getBlockHeight();
        const lastBlock = requireNotNull(await this.context.blockchainIndexer.getBlockAt(blockHeight));
        return blockHeight > Number(state.lastUnderlyingBlock) && lastBlock.timestamp > Number(state.lastUnderlyingTimestamp);
    }

    async enterPool(poolAddress: string, collateralAmountWei: BNish) {
        const pool = await CollateralPool.at(poolAddress);
        const res = await pool.enter(0, false, { from: this.nativeAddress, value: collateralAmountWei.toString() });
        return requiredEventArgs(res, "Entered");
    }

    async exitPool(poolAddress: string, tokenAmountWei: BNish) {
        const pool = await CollateralPool.at(poolAddress);
        const res = await pool.exit(tokenAmountWei, TokenExitType.KEEP_RATIO, { from: this.nativeAddress });
        return requiredEventArgs(res, "Exited");
    }

    stateFileDir(type: StateData["type"]) {
        const controllerAddress = this.context.assetManagerController.address.slice(2, 10);
        return path.resolve(UserBot.userDataDir, `${controllerAddress}-${this.fassetConfig.fAssetSymbol}-${type}`);
    }

    stateFilePath(type: StateData["type"], requestIdOrPath: BNish | string) {
        if (typeof requestIdOrPath !== "string" || /^\d+$/.test(requestIdOrPath)) {
            return path.resolve(this.stateFileDir(type), `${requestIdOrPath}.json`);
        } else {
            return path.resolve(requestIdOrPath); // full path passed
        }
    }

    writeState(data: StateData): void {
        const dir = this.stateFileDir(data.type);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const fname = path.resolve(dir, `${data.requestId}.json`);
        fs.writeFileSync(fname, JSON.stringify(data, null, 4));
    }

    readState<T extends StateData["type"]>(type: T, requestIdOrPath: BNish | string): Extract<StateData, { type: T }> {
        const fname = this.stateFilePath(type, requestIdOrPath);
        const json = fs.readFileSync(fname).toString();
        return JSON.parse(json);
    }

    readStateList<T extends StateData["type"]>(type: T): Extract<StateData, { type: T }>[] {
        const dir = this.stateFileDir(type);
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs.readdirSync(dir)
            .filter((fn) => /^\d+\.json$/.test(fn))
            .map((fn) => {
                const fpath = path.resolve(dir, fn);
                const json = fs.readFileSync(fpath).toString();
                return JSON.parse(json);
            })
    }

    deleteState(data: StateData, requestIdOrPath?: BNish | string): void {
        const fname = this.stateFilePath(data.type, requestIdOrPath ?? data.requestId);
        fs.unlinkSync(fname);
    }

    timestampToDateString(timestamp: number): string {
        return new Date(timestamp * 1000).toISOString();
    }

    dateStringToTimestamp(dateString: string): number {
        return Math.floor(new Date(dateString).getTime() / 1000);
    }
}
