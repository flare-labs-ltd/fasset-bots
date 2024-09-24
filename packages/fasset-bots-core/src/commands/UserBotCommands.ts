import BN from "bn.js";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { Secrets } from "../config";
import { closeBotConfig, createBotConfig } from "../config/BotConfig";
import { loadAgentConfigFile } from "../config/config-file-loader";
import { createAgentBotContext } from "../config/create-asset-context";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { AssetManagerSettings } from "../fasset/AssetManagerTypes";
import { PaymentReference } from "../fasset/PaymentReference";
import { Minter } from "../mock/Minter";
import { Redeemer } from "../mock/Redeemer";
import { attestationProved } from "../underlying-chain/AttestationHelper";
import { IVerificationApiClient } from "../underlying-chain/interfaces/IVerificationApiClient";
import { CommandLineError, assertNotNullCmd } from "../utils/command-line-errors";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { formatArgs } from "../utils/formatting";
import { BNish, ZERO_ADDRESS, requireNotNull, sumBN, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { latestBlockTimestamp } from "../utils/web3helpers";
import { web3DeepNormalize } from "../utils/web3normalize";
import { InfoBotCommands } from "./InfoBotCommands";

export const CollateralPool = artifacts.require("CollateralPool");

// exit codes
const ERR_CANNOT_EXECUTE_YET = 10;

interface MintData {
    type: "mint";
    requestId: string;
    transactionHash: string;
    paymentAddress: string;
    executorAddress: string;
    createdAt: string;
    proofRequest?: { round: number, data: string };
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
    proofRequest?: { round: number, data: string };
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

export type CleanupRegistration = (handler: () => Promise<void>) => void;

export class UserBotCommands {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetAgentContext,
        public fAssetSymbol: string,
        public nativeAddress: string,
        public underlyingAddress: string,
        public userDataDir: string,
    ) {}

    /**
     * Creates instance of UserBot.
     * @param configFileName path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of UserBot
     */
    static async create(secretsFile: string, configFileName: string, fAssetSymbol: string, userDataDir: string, registerCleanup?: CleanupRegistration) {
        const secrets = Secrets.load(secretsFile);
        const nativeAddress = secrets.required("user.native.address");
        logger.info(`User ${nativeAddress} started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        const configFile = loadAgentConfigFile(configFileName, `User ${nativeAddress}`);
        // init web3 and accounts
        const nativePrivateKey = secrets.required("user.native.private_key");
        const accounts = await initWeb3(authenticatedHttpProvider(configFile.rpcUrl, secrets.optional("apiKey.native_rpc")), [nativePrivateKey], null);
        /* istanbul ignore next */
        if (!accounts.includes(nativeAddress)) {
            logger.error(`User ${nativeAddress} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        const botConfig = await createBotConfig("user", secrets, configFile, nativeAddress);
        registerCleanup?.(() => closeBotConfig(botConfig));
        // verify fasset config
        const fassetConfig = botConfig.fAssets.get(fAssetSymbol);
        assertNotNullCmd(fassetConfig, `Invalid FAsset symbol ${fAssetSymbol}`);
        const context = await createAgentBotContext(botConfig, fassetConfig);
        // create underlying wallet key
        const underlyingAddress = await this.loadUnderlyingAddress(secrets, context, fassetConfig.verificationClient);
        console.error(chalk.cyan("Environment successfully initialized."));
        logger.info(`User ${nativeAddress} successfully finished initializing cli environment.`);
        logger.info(`Asset manager controller is ${context.assetManagerController.address}, asset manager for ${fAssetSymbol} is ${context.assetManager.address}.`);
        return new UserBotCommands(context, fAssetSymbol, nativeAddress, underlyingAddress, userDataDir);
    }

    // User must make sure that underlying address is valid and normalized.
    // Otherwise the agent will reject the redemption and the user will lose the fasset value.
    static async loadUnderlyingAddress(secrets: Secrets, context: IAssetAgentContext, verificationClient: IVerificationApiClient) {
        const chainId = context.chainInfo.chainId;
        const chainName = chainId.chainName;
        // read address and private key from secrets
        const underlyingAddress = secrets.required(`user.${chainName}.address`);
        const underlyingPrivateKey = secrets.required(`user.${chainName}.private_key`);
        // validate
        const res = await verificationClient.checkAddressValidity(chainId.sourceId, underlyingAddress);
        if (!res.isValid) {
            logger.error(`User's underlying address ${underlyingAddress} is invalid.`);
            throw new CommandLineError("Invalid underlying address");
        }
        // store in wallet
        await context.wallet.addExistingAccount(res.standardAddress, underlyingPrivateKey);
        return res.standardAddress;
    }

    infoBot(): InfoBotCommands {
        return new InfoBotCommands(this.context);
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
    async reserveCollateral(agentVault: string, lots: BNish, executorAddress: string, executorFeeNatWei?: BNish, noPay: boolean = false): Promise<BN> {
        logger.info(`User ${this.nativeAddress} started minting with agent ${agentVault}.`);
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Reserving collateral...");
        logger.info(`User ${this.nativeAddress} is reserving collateral with agent ${agentVault} and ${lots} lots.`);
        const crt = await minter.reserveCollateral(agentVault, lots, executorAddress, executorFeeNatWei);
        logger.info(`User ${this.nativeAddress} reserved collateral ${formatArgs(crt)} with agent ${agentVault} and ${lots} lots.`);
        console.log(`Paying on the underlying chain for reservation ${crt.collateralReservationId} to address ${crt.paymentAddress}...`);
        logger.info(`User ${this.nativeAddress} is paying on underlying chain for reservation ${crt.collateralReservationId} to agent's ${agentVault} address ${crt.paymentAddress}.`);
        if (noPay) return crt.collateralReservationId;
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
        logger.info(`User ${this.nativeAddress} paid on underlying chain for reservation ${crt.collateralReservationId} to agent's ${agentVault} with transaction ${txHash}.`);
        return crt.collateralReservationId;
    }

    /**
     * Mints desired amount of lots against desired agent.
     * @param agentVault agent's vault address
     * @param lots number of lots to mint
     * @param executorAddress optional address of the executor
     * @param executorFeeNatWei optional executor fee (required if executor is used)
     */
    async mint(agentVault: string, lots: BNish, noWait: boolean, noPay: boolean = false, executorAddress: string = ZERO_ADDRESS, executorFeeNatWei?: BNish): Promise<void> {
        const requestId = await this.reserveCollateral(agentVault, lots, executorAddress, executorFeeNatWei, noPay);
        if (noWait || noPay) {
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
        await this.proveAndExecuteSavedMinting(requestId, false);
        logger.info(`User ${this.nativeAddress} finished minting with agent ${agentVault}.`);
    }

    /**
     * Proves minting payment and executes minting.
     * @param requestIdOrPath minting request id or minting state file path
     */
    async proveAndExecuteSavedMinting(requestIdOrPath: BNish | string, noWait: boolean) {
        const state = this.readState("mint", requestIdOrPath);
        if (noWait) {
            await this.proveAndExecuteSavedMintingNoWait(requestIdOrPath, state);
        } else {
            await this.proveAndExecuteMinting(state.requestId, state.transactionHash, state.paymentAddress);
            this.deleteState(state, requestIdOrPath);
        }
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
        logger.info(`User ${this.nativeAddress} is waiting for proof of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`);
        const proof = await minter.proveMintingPayment(paymentAddress, transactionHash);
        console.log(`Executing payment...`);
        logger.info(`User ${this.nativeAddress} is executing minting with proof ${JSON.stringify(web3DeepNormalize(proof))} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`);
        await minter.executeProvedMinting(collateralReservationId, proof, ZERO_ADDRESS);
        console.log("Done");
        logger.info(`User ${this.nativeAddress} executed minting with proof ${JSON.stringify(web3DeepNormalize(proof))} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`);
    }

    async proveAndExecuteSavedMintingNoWait(requestIdOrPath: BNish | string, state: MintData): Promise<void> {
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        // if proof request has not been submitted yet, submit (when transction is finalized)
        if (state.proofRequest == null) {
            logger.info(`User ${this.nativeAddress} is checking for transaction ${state.transactionHash} finalization for reservation ${state.requestId}.`);
            // check if finalized
            const transactionFinalized = await minter.isTransactionFinalized(state.transactionHash);
            if (!transactionFinalized) {
                throw new CommandLineError(`Transaction ${state.transactionHash} not finalized yet.`, ERR_CANNOT_EXECUTE_YET)
            }
            // submit proof request
            try {
                const request = await minter.requestPaymentProof(state.paymentAddress, state.transactionHash);
                logger.info(`User ${this.nativeAddress} has submitted payment proof request in round ${request.round} with data ${request.data} for reservation ${state.requestId}.`);
                state.proofRequest = request;
                this.writeState(state, requestIdOrPath);
            } catch (error) {
                throw CommandLineError.replace(error, `Payment proof not available yet.`, ERR_CANNOT_EXECUTE_YET);
            }
        }
        // check if proof is available
        console.log(`User ${this.nativeAddress} is checking for existence of the proof of underlying payment transaction ${state.transactionHash}...`);
        const proof = await minter.obtainPaymentProof(state.proofRequest.round, state.proofRequest.data);
        if (!attestationProved(proof)) {
            throw new CommandLineError(`State connector proof for transaction ${state.transactionHash} is not available yet.`, ERR_CANNOT_EXECUTE_YET);
        }
        console.log(`Executing payment...`);
        logger.info(`User ${this.nativeAddress} is executing minting with proof ${JSON.stringify(web3DeepNormalize(proof))} of underlying payment transaction ${state.transactionHash} for reservation ${state.requestId}.`);
        await minter.executeProvedMinting(state.requestId, proof, ZERO_ADDRESS);
        console.log("Done");
        logger.info(`User ${this.nativeAddress} executed minting with proof ${JSON.stringify(web3DeepNormalize(proof))} of underlying payment transaction ${state.transactionHash} for reservation ${state.requestId}.`);
        this.deleteState(state, requestIdOrPath);
    }

    async listMintings(): Promise<void> {
        const stateList = this.readStateList("mint");
        const timestamp = await latestBlockTimestamp();
        const settings = await this.context.assetManager.getSettings();
        console.log('Minting requests (id and status):')
        for (const state of stateList) {
            const status = this.mintingStatus(state, timestamp, settings);
            console.log(`- ${state.requestId}  ${status}`);
        }
    }

    mintingStatus(state: MintData, timestamp: number, settings: AssetManagerSettings) {
        const stateTs = this.dateStringToTimestamp(state.createdAt);
        const expired = timestamp - stateTs >= Number(settings.attestationWindowSeconds);
        return expired ? MintingStatus.EXPIRED : MintingStatus.PENDING;
    }

    /**
     * Redeems desired amount of lots.
     * @param lots number of lots to redeem
     * @param executorAddress
     * @param executorFeeNatWei
     */
    async redeem(lots: BNish, executorAddress: string = ZERO_ADDRESS, executorFeeNatWei?: BNish, redemptionTarget?: string): Promise<BN[]> {
        const redeemer = new Redeemer(this.context, this.nativeAddress, redemptionTarget ?? this.underlyingAddress);
        console.log(`Asking for redemption of ${lots} lots`);
        logger.info(`User ${this.nativeAddress} is asking for redemption of ${lots} lots.`);
        const [requests, remainingLots] = await redeemer.requestRedemption(lots, executorAddress, executorFeeNatWei);
        if (!toBN(remainingLots).isZero()) {
            console.log(`Maximum number of redeemed tickets exceeded. ${remainingLots} lots have remained unredeemed. You can execute redeem again until all are redeemed.`);
            logger.info(`User ${this.nativeAddress} exceeded maximum number of redeemed tickets. ${remainingLots} lots have remained unredeemed.`);
        }
        console.log(`Triggered ${requests.length} payment requests (addresses, block numbers and timestamps are on underlying chain):`);
        logger.info(`User ${this.nativeAddress} triggered ${requests.length} payment requests.`);
        let loggedRequests = ``;
        const requestFiles: string[] = [];
        for (const req of requests) {
            const amount = toBN(req.valueUBA).sub(toBN(req.feeUBA));
            const info = `    id=${req.requestId}  to=${req.paymentAddress}  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  ` +
                `firstBlock=${req.firstUnderlyingBlock}  lastBlock=${req.lastUnderlyingBlock}  lastTimestamp=${req.lastUnderlyingTimestamp}`;
            console.log(info);
            loggedRequests = loggedRequests + `User ${this.nativeAddress} triggered request:${info}\n`;
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
        return requests.map(req => toBN(req.requestId));
    }

    /**
     * Call redemption default with saved redemption state.
     * @param requestIdOrPath redemption request id or minting state file path
     */
    async savedRedemptionDefault(requestIdOrPath: BNish | string, noWait: boolean): Promise<void> {
        const state = this.readState("redeem", requestIdOrPath);
        if (noWait) {
            await this.redemptionDefaultNoWait(requestIdOrPath, state);
        } else {
            await this.redemptionDefault(state.amountUBA, state.paymentReference, state.firstUnderlyingBlock, state.lastUnderlyingBlock, state.lastUnderlyingTimestamp);
            this.deleteState(state, requestIdOrPath);
        }
    }

    /**
     * Calls redemption default after proving underlying non payment for redemption.
     * @param amountUBA amount to be paid in redemption
     * @param paymentReference payment reference to be used in redemption
     * @param firstUnderlyingBlock underlying block in which redemption request was created
     * @param lastUnderlyingBlock last underlying block within payment performed
     * @param lastUnderlyingTimestamp last underlying timestamp within payment performed
     */
    async redemptionDefault(amountUBA: BNish, paymentReference: string, firstUnderlyingBlock: BNish, lastUnderlyingBlock: BNish, lastUnderlyingTimestamp: BNish): Promise<void> {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        const requestId = PaymentReference.decodeId(paymentReference);
        logger.info(`User ${this.nativeAddress} is defaulting redemption ${requestId}.`);
        if (paymentReference !== PaymentReference.redemption(requestId)) {
            logger.error(`User ${this.nativeAddress} provided invalid payment reference ${paymentReference} for redemption ${requestId}.`);
            throw new CommandLineError("Invalid payment reference");
        }
        console.log("Waiting for payment default proof...");
        logger.info(`User ${this.nativeAddress} is waiting for proof of underlying non payment for redemption ${requestId}.`);
        const proof = await redeemer.proveNonPayment(this.underlyingAddress, paymentReference, amountUBA,
            firstUnderlyingBlock, lastUnderlyingBlock, lastUnderlyingTimestamp);
        console.log("Executing payment default...");
        logger.info(`User ${this.nativeAddress} is executing payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} redemption ${requestId}.`);
        await redeemer.executePaymentDefault(requestId, proof, ZERO_ADDRESS); // executor must call from own user address
        console.log("Done");
        logger.info(`User ${this.nativeAddress} executed payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} redemption ${requestId}.`);
    }

    async redemptionDefaultNoWait(requestIdOrPath: BNish | string, state: RedeemData): Promise<void> {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        // if proof request has not been submitted yet, submit
        if (state.proofRequest == null) {
            logger.info(`User ${this.nativeAddress} is submitting non-payment proof request for redemption ${state.requestId}.`);
            try {
                const request = await redeemer.requestNonPaymentProof(this.underlyingAddress, state.paymentReference, state.amountUBA,
                    state.firstUnderlyingBlock, state.lastUnderlyingBlock, state.lastUnderlyingTimestamp);
                logger.info(`User ${this.nativeAddress} has submitted non-payment proof request in round ${request.round} with data ${request.data} for redemption ${state.requestId}.`);
                state.proofRequest = request;
                this.writeState(state, requestIdOrPath);
            } catch (error) {
                throw CommandLineError.replace(error, `Cannot submit non-payment proof for redemption ${state.requestId} - agent probably still has time to pay.`, ERR_CANNOT_EXECUTE_YET);
            }
        }
        // check if proof is available
        console.log(`User ${this.nativeAddress} is checking for existence of the proof of non-payment for redemption ${state.requestId}...`);
        const proof = await redeemer.obtainNonPaymentProof(state.proofRequest.round, state.proofRequest.data);
        if (!attestationProved(proof)) {
            throw new CommandLineError(`Non-payment proof for redemption ${state.requestId} is not available yet.`, ERR_CANNOT_EXECUTE_YET);
        }
        console.log("Executing payment default...");
        logger.info(`User ${this.nativeAddress} is executing payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} for redemption ${state.requestId}.`);
        await redeemer.executePaymentDefault(state.requestId, proof, ZERO_ADDRESS); // executor must call from own user address
        console.log("Done");
        logger.info(`User ${this.nativeAddress} executed payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} for redemption ${state.requestId}.`);
        this.deleteState(state, requestIdOrPath);
    }

    async updateAllMintings() {
        const list = this.readStateList("mint");
        const settings = await this.context.assetManager.getSettings();
        const timestamp = await latestBlockTimestamp();
        for (const state of list) {
            console.log(`Checking status of minting ${state.requestId}`);
            const status = this.mintingStatus(state, timestamp, settings);
            if (status === MintingStatus.PENDING) {
                try {
                    await this.proveAndExecuteSavedMintingNoWait(state.requestId, state);
                } catch (error) {
                    if (error instanceof CommandLineError && error.exitCode === ERR_CANNOT_EXECUTE_YET) {
                        console.log(error.message);
                    } else {
                        logger.error(`Execute minting for ${state.requestId} failed:`, error);
                        console.error(`Execute minting for ${state.requestId} failed: ${error}`);
                    }
                }
            } else if (status === MintingStatus.EXPIRED) {
                console.log(`Minting ${state.requestId} expired in indexer and will be eventually defaulted by the agent.`);
                this.deleteState(state);
            }
        }
    }

    async updateAllRedemptions() {
        const list = this.readStateList("redeem");
        const settings = await this.context.assetManager.getSettings();
        const timestamp = await latestBlockTimestamp();
        let successful = 0;
        let defaulted = 0;
        let expired = 0;
        for (const state of list) {
            const status = await this.redemptionStatus(state, timestamp, settings);
            if (status === RedemptionStatus.SUCCESS) {
                console.log(`Redemption ${state.requestId} finished successfully.`);
                this.deleteState(state);
                ++successful;
            } else if (status === RedemptionStatus.DEFAULT) {
                console.log(`Redemption ${state.requestId} wasn't paid in time, executing default...`);
                try {
                    await this.redemptionDefaultNoWait(state.requestId, state);
                    ++defaulted;
                } catch (error) {
                    if (error instanceof CommandLineError && error.exitCode === ERR_CANNOT_EXECUTE_YET) {
                        console.log(error.message);
                    } else {
                        logger.error(`Redemption default for ${state.requestId} failed:`, error);
                        console.error(`Redemption default for ${state.requestId} failed: ${error}`);
                    }
                }
            } else if (status === RedemptionStatus.EXPIRED) {
                console.log(`Redemption ${state.requestId} expired in indexer and will be eventually defaulted by the agent.`);
                this.deleteState(state);
                ++expired;
            }
        }
        const remaining = list.length - successful - defaulted - expired;
        return { total: list.length, successful, defaulted, expired, remaining };
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

    stateFileDir(type: StateData["type"]) {
        const controllerAddress = this.context.assetManagerController.address.slice(2, 10);
        return path.resolve(this.userDataDir, `${controllerAddress}-${this.fAssetSymbol}-${type}`);
    }

    stateFilePath(type: StateData["type"], requestIdOrPath: BNish | string) {
        if (typeof requestIdOrPath !== "string" || /^\d+$/.test(requestIdOrPath)) {
            return path.resolve(this.stateFileDir(type), `${requestIdOrPath}.json`);
        } else {
            return path.resolve(requestIdOrPath); // full path passed
        }
    }

    validateStateFilePath(fullpath: string, type: StateData["type"], requestIdOrPath: BNish | string) {
        if (fs.existsSync(fullpath)) return;
        const typeStr = type === "mint" ? "minting" : "redemption";
        if (typeof requestIdOrPath !== "string" || /^\d+$/.test(requestIdOrPath)) {
            throw new CommandLineError(`There is no active ${typeStr} with id ${requestIdOrPath}`);
        } else {
            throw new CommandLineError(`Missing ${typeStr} state file ${fullpath}`);
        }
    }

    writeState(data: StateData, requestIdOrPath?: BNish | string): void {
        const fname = this.stateFilePath(data.type, requestIdOrPath ?? data.requestId);
        const dir = path.dirname(fname);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fname, JSON.stringify(data, null, 4));
    }

    readState<T extends StateData["type"]>(type: T, requestIdOrPath: BNish | string): Extract<StateData, { type: T }> {
        const fname = this.stateFilePath(type, requestIdOrPath);
        this.validateStateFilePath(fname, type, requestIdOrPath);
        const json = fs.readFileSync(fname).toString();
        return JSON.parse(json);
    }

    readStateList<T extends StateData["type"]>(type: T): Extract<StateData, { type: T }>[] {
        const dir = this.stateFileDir(type);
        if (!fs.existsSync(dir)) {
            return [];
        }
        return fs
            .readdirSync(dir)
            .filter((fn) => /^\d+\.json$/.test(fn))
            .map((fn) => {
                const fpath = path.resolve(dir, fn);
                const json = fs.readFileSync(fpath).toString();
                return JSON.parse(json);
            });
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
