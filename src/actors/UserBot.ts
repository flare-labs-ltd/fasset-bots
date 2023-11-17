import chalk from "chalk";
import os from "os";
import fs from "fs";
import path from "path";
import { BotConfig, BotFAssetConfig, createBotConfig, loadAgentConfigFile } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { getSecrets, requireSecret } from "../config/secrets";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { PaymentReference } from "../fasset/PaymentReference";
import { Minter } from "../mock/Minter";
import { Redeemer } from "../mock/Redeemer";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { formatArgs } from "../utils/formatting";
import { BNish, CommandLineError, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { web3DeepNormalize } from "../utils/web3normalize";

interface MintData {
    type: 'mint';
    requestId: string;
    transactionHash: string;
    paymentAddress: string;
    createdAt: string;
}

interface RedeemData {
    type: 'redeem';
    requestId: string;
    amountUBA: string;
    paymentReference: string;
    firstUnderlyingBlock: string;
    lastUnderlyingBlock: string;
    lastUnderlyingTimestamp: string;
    createdAt: string;
}

type StateData = MintData | RedeemData;

export class UserBot {
    context!: IAssetAgentBotContext;
    botConfig!: BotConfig;
    fassetConfig!: BotFAssetConfig;
    nativeAddress!: string;
    underlyingAddress!: string;

    static userDataDir: string = process.env.FASSET_USER_DATA_DIR ?? path.resolve(os.homedir(), 'fasset');

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
        this.nativeAddress = requireSecret("user.native_address");
        logger.info(`User ${this.nativeAddress} started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        const runConfig = loadAgentConfigFile(configFile, `User ${this.nativeAddress}`);
        // init web3 and accounts
        const nativePrivateKey = requireSecret("user.native_private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(runConfig.rpcUrl, getSecrets().apiKey.native_rpc), [nativePrivateKey], null);
        /* istanbul ignore next */
        if (!accounts.includes(this.nativeAddress)) {
            logger.error(`User ${this.nativeAddress} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        this.botConfig = await createBotConfig(runConfig, this.nativeAddress);
        const chainConfig = this.botConfig.fAssets.find((cc) => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) {
            logger.error(`User ${this.nativeAddress} has invalid FAsset symbol.`);
            throw new CommandLineError("Invalid FAsset symbol");
        }
        this.context = await createAssetContext(this.botConfig, chainConfig);
        this.fassetConfig = chainConfig;
        // create underlying wallet key
        this.underlyingAddress = requireSecret("user.underlying_address");
        const underlyingPrivateKey = requireSecret("user.underlying_private_key");
        await this.context.wallet.addExistingAccount(this.underlyingAddress, underlyingPrivateKey);
        console.error(chalk.cyan("Environment successfully initialized."));
        logger.info(`User ${this.nativeAddress} successfully finished initializing cli environment.`);
    }

    /**
     * Updates underlying block and timestamp on fasset contracts.
     */
    async updateUnderlyingTime() {
        logger.info(`User ${this.nativeAddress} started updating underlying block time.`);
        console.log("Updating underlying block time....");
        await proveAndUpdateUnderlyingBlock(this.context.attestationProvider, this.context.assetManager, this.nativeAddress);
        logger.info(`User ${this.nativeAddress} finished updating underlying block time.`);
    }

    /**
     * Mints desired amount of lots against desired agent.
     * @param agentVault agent's vault address
     * @param lots number of lots to mint
     */
    async mint(agentVault: string, lots: BNish): Promise<void> {
        logger.info(`User ${this.nativeAddress} started minting with agent ${agentVault}.`);
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Reserving collateral...");
        logger.info(`User ${this.nativeAddress} is reserving collateral with agent ${agentVault} and ${lots} lots.`);
        const crt = await minter.reserveCollateral(agentVault, lots);
        logger.info(`User ${this.nativeAddress} reserved collateral ${formatArgs(crt)} with agent ${agentVault} and ${lots} lots.`);
        console.log(`Paying on the underlying chain for reservation ${crt.collateralReservationId} to address ${crt.paymentAddress}...`);
        logger.info(
            `User ${this.nativeAddress} is paying on underlying chain for reservation ${
                crt.collateralReservationId
            } to agent's ${agentVault} address ${crt.paymentAddress}.`
        );
        const txHash = await minter.performMintingPayment(crt);
        const state: MintData = {
            type: 'mint',
            requestId: String(crt.collateralReservationId),
            paymentAddress: crt.paymentAddress,
            transactionHash: txHash,
            createdAt: new Date().toISOString()
        };
        this.writeState(state);
        logger.info(
            `User ${this.nativeAddress} paid on underlying chain for reservation ${crt.collateralReservationId} to agent's ${agentVault} with transaction ${txHash}.`);
        await this.proveAndExecuteMinting(crt.collateralReservationId, txHash, crt.paymentAddress);
        logger.info(`User ${this.nativeAddress} finished minting with agent ${agentVault}.`);
        this.deleteState(state);
    }

    async proveAndExecuteSavedMinting(requestId: BNish) {
        const state = this.readState('mint', requestId);
        await this.proveAndExecuteMinting(state.requestId, state.transactionHash, state.paymentAddress);
        this.deleteState(state);
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
            `User ${this.nativeAddress} is waiting for transaction ${transactionHash} finalization for reservation ${collateralReservationId}.`
        );
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
        await minter.executeProvedMinting(collateralReservationId, proof);
        console.log("Done");
        logger.info(
            `User ${this.nativeAddress} executed minting with proof ${JSON.stringify(
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
        logger.info(`User ${this.nativeAddress} is asking for redemption of ${lots} lots.`);
        const [requests, remainingLots] = await redeemer.requestRedemption(lots);
        if (!toBN(remainingLots).isZero()) {
            console.log(
                `Maximum number of redeemed tickets exceeded. ${remainingLots} lots have remained unredeemed. You can execute redeem again until all are redeemed.`
            );
            logger.info(
                `User ${this.nativeAddress} exceeded maximum number of redeemed tickets. ${remainingLots} lots have remained unredeemed.`
            );
        }
        console.log(`Triggered ${requests.length} payment requests (addresses, block numbers and timestamps are on underlying chain):`);
        logger.info(`User ${this.nativeAddress} triggered ${requests.length} payment requests.`);
        let loggedRequests = ``;
        for (const req of requests) {
            const amount = toBN(req.valueUBA).sub(toBN(req.feeUBA));
            console.log(
                `    id=${req.requestId}  to=${req.paymentAddress}  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${req.lastUnderlyingBlock}  lastTimestamp=${req.lastUnderlyingTimestamp}`
            );
            loggedRequests =
                loggedRequests +
                `User ${this.nativeAddress} triggered request:    id=${req.requestId}  to=${
                    req.paymentAddress
                }  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${
                    req.lastUnderlyingBlock
                }  lastTimestamp=${req.lastUnderlyingTimestamp}\n`;
            this.writeState({
                type: 'redeem',
                requestId: String(req.requestId),
                amountUBA: String(amount),
                paymentReference: req.paymentReference,
                firstUnderlyingBlock: String(req.firstUnderlyingBlock),
                lastUnderlyingBlock: String(req.lastUnderlyingBlock),
                lastUnderlyingTimestamp: String(req.lastUnderlyingTimestamp),
                createdAt: new Date().toISOString(),
            });
        }
        logger.info(loggedRequests);
    }

    async savedRedemptionDefault(requestId: BNish) {
        const state = this.readState('redeem', requestId);
        await this.redemptionDefault(state.amountUBA, state.paymentReference, state.firstUnderlyingBlock, state.lastUnderlyingBlock, state.lastUnderlyingTimestamp);
        this.deleteState(state);
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
        logger.info(
            `User ${this.nativeAddress} is executing payment default with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} redemption ${requestId}.`
        );
        await redeemer.executePaymentDefault(requestId, proof);
        console.log("Done");
        logger.info(
            `User ${this.nativeAddress} executed payment default with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} redemption ${requestId}.`
        );
    }

    writeState(data: StateData) {
        const dir = path.resolve(UserBot.userDataDir, `${this.fassetConfig.fAssetSymbol}-${data.type}`);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const fname = path.resolve(dir, `${data.requestId}.json`);
        fs.writeFileSync(fname, JSON.stringify(data, null, 4));
    }

    readState<T extends StateData['type']>(type: T, requestId: BNish): Extract<StateData, { type: T }> {
        const fname = path.resolve(UserBot.userDataDir, `${this.fassetConfig.fAssetSymbol}-${type}/${requestId}.json`);
        const json = fs.readFileSync(fname).toString();
        return JSON.parse(json);
    }

    deleteState(data: StateData) {
        const fname = path.resolve(UserBot.userDataDir, `${this.fassetConfig.fAssetSymbol}-${data.type}/${data.requestId}.json`);
        fs.unlinkSync(fname);
    }
}
