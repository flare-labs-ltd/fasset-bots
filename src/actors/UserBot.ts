import chalk from "chalk";
import { readFileSync } from "fs";
import { BotConfig, BotConfigFile, createBotConfig } from "../config/BotConfig";
import { createAssetContext } from "../config/create-asset-context";
import { AvailableAgentInfo } from "../fasset/AssetManagerTypes";
import { IAssetContext } from "../fasset/IAssetContext";
import { Minter } from "../mock/Minter";
import { Redeemer } from "../mock/Redeemer";
import { proveAndUpdateUnderlyingBlock } from "../utils/fasset-helpers";
import { BNish, CommandLineError, requireEnv, toBN } from "../utils/helpers";
import { initWeb3 } from "../utils/web3";
import { PaymentReference } from "../fasset/PaymentReference";
import { logger } from "../utils/logger";
import { web3DeepNormalize } from "../utils/web3normalize";
import { formatArgs } from "../utils/formatting";

export class UserBot {
    context!: IAssetContext;
    botConfig!: BotConfig;
    nativeAddress!: string;
    underlyingAddress!: string;

    static async create(configFile: string, fAssetSymbol: string) {
        const bot = new UserBot();
        await bot.initialize(configFile, fAssetSymbol);
        return bot;
    }

    async initialize(configFile: string, fAssetSymbol: string) {
        logger.info(`User ${requireEnv("USER_ADDRESS")} started to initialize cli environment.`);
        console.error(chalk.cyan("Initializing environment..."));
        const runConfig = JSON.parse(readFileSync(configFile).toString()) as BotConfigFile;
        // init web3 and accounts
        this.nativeAddress = requireEnv("USER_ADDRESS");
        const nativePrivateKey = requireEnv("USER_PRIVATE_KEY");
        const accounts = await initWeb3(runConfig.rpcUrl, [nativePrivateKey], null);
        /* istanbul ignore next */
        if (this.nativeAddress !== accounts[0]) {
            logger.error(`User ${requireEnv("USER_ADDRESS")} has invalid address/private key pair.`);
            throw new Error("Invalid address/private key pair");
        }
        // create config
        this.botConfig = await createBotConfig(runConfig, this.nativeAddress);
        const chainConfig = this.botConfig.chains.find(cc => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) {
            logger.error(`User ${requireEnv('USER_ADDRESS')} has invalid FAsset symbol.`);
            throw new CommandLineError("Invalid FAsset symbol");
        }
        this.context = await createAssetContext(this.botConfig, chainConfig);
        // create underlying wallet key
        this.underlyingAddress = requireEnv("USER_UNDERLYING_ADDRESS");
        const underlyingPrivateKey = requireEnv("USER_UNDERLYING_PRIVATE_KEY");
        await this.context.wallet.addExistingAccount(this.underlyingAddress, underlyingPrivateKey);
        console.error(chalk.cyan("Environment successfully initialized."));
        logger.info(`User ${requireEnv("USER_ADDRESS")} successfully finished initializing cli environment.`);
    }

    async updateUnderlyingTime() {
        logger.info(`User ${requireEnv("USER_ADDRESS")} started updating underlying block time.`);
        console.log("Updating underlying block time....");
        await proveAndUpdateUnderlyingBlock(this.context, this.nativeAddress);
        logger.info(`User ${requireEnv("USER_ADDRESS")} finished updating underlying block time.`);
    }

    async getAvailableAgents() {
        const result: AvailableAgentInfo[] = [];
        const chunkSize = 10;
        let start = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { 0: list } = await this.context.assetManager.getAvailableAgentsDetailedList(start, chunkSize);
            result.splice(result.length, 0, ...list);
            if (list.length < chunkSize) break;
            start += list.length;
        }
        return result;
    }

    async mint(agentVault: string, lots: BNish) {
        logger.info(`User ${requireEnv("USER_ADDRESS")} started minting with agent ${agentVault}.`);
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Reserving collateral...");
        logger.info(`User ${requireEnv("USER_ADDRESS")} is reserving collateral with agent ${agentVault} and ${lots} lots.`);
        const crt = await minter.reserveCollateral(agentVault, lots);
        logger.info(`User ${requireEnv("USER_ADDRESS")} reserved collateral ${formatArgs(crt)} with agent ${agentVault} and ${lots} lots.`);
        console.log(`Paying on the underlying chain for reservation ${crt.collateralReservationId} to address ${crt.paymentAddress}...`);
        logger.info(
            `User ${requireEnv("USER_ADDRESS")} is paying on underlying chain for reservation ${crt.collateralReservationId} to agent's ${agentVault} address ${
                crt.paymentAddress
            }.`
        );
        const txHash = await minter.performMintingPayment(crt);
        logger.info(
            `User ${requireEnv("USER_ADDRESS")} paid on underlying chain for reservation ${
                crt.collateralReservationId
            } to agent's ${agentVault} with transaction ${txHash}.`
        );
        await this.proveAndExecuteMinting(crt.collateralReservationId, txHash, crt.paymentAddress);
        logger.info(`User ${requireEnv("USER_ADDRESS")} finished minting with agent ${agentVault}.`);
    }

    async proveAndExecuteMinting(collateralReservationId: BNish, transactionHash: string, paymentAddress: string) {
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Waiting for transaction finalization...");
        logger.info(
            `User ${requireEnv("USER_ADDRESS")} is waiting for transaction ${transactionHash} finalization for reservation ${collateralReservationId}.`
        );
        await minter.waitForTransactionFinalization(transactionHash);
        console.log(`Waiting for proof of underlying payment transaction ${transactionHash}...`);
        logger.info(
            `User ${requireEnv(
                "USER_ADDRESS"
            )} is waiting for proof of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
        const proof = await minter.proveMintingPayment(paymentAddress, transactionHash);
        console.log(`Executing payment...`);
        logger.info(
            `User ${requireEnv("USER_ADDRESS")} is executing minting with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
        await minter.executeProvedMinting(collateralReservationId, proof);
        console.log("Done");
        logger.info(
            `User ${requireEnv("USER_ADDRESS")} executed minting with proof ${JSON.stringify(
                web3DeepNormalize(proof)
            )} of underlying payment transaction ${transactionHash} for reservation ${collateralReservationId}.`
        );
    }

    async redeem(lots: BNish) {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        console.log(`Asking for redemption of ${lots} lots`);
        logger.info(`User ${requireEnv("USER_ADDRESS")} is asking for redemption of ${lots} lots.`);
        const [requests, remainingLots] = await redeemer.requestRedemption(lots);
        if (!toBN(remainingLots).isZero()) {
            console.log(
                `Maximum number of redeemed tickets exceeded. ${remainingLots} lots have remained unredeemed. You can execute redeem again until all are redeemed.`
            );
            logger.info(`User ${requireEnv("USER_ADDRESS")} exceeded maximum number of redeemed tickets. ${remainingLots} lots have remained unredeemed.`);
        }
        console.log(`Triggered ${requests.length} payment requests (addresses, block numbers and timestamps are on underlying chain):`);
        logger.info(`User ${requireEnv("USER_ADDRESS")} triggered ${requests.length} payment requests.`);
        let loggedRequests = ``;
        for (const req of requests) {
            const amount = toBN(req.valueUBA).sub(toBN(req.feeUBA));
            console.log(
                `    id=${req.requestId}  to=${req.paymentAddress}  amount=${amount}  agentVault=${req.agentVault}  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${req.lastUnderlyingBlock}  lastTimestamp=${req.lastUnderlyingTimestamp}`
            );
            loggedRequests =
                loggedRequests +
                `User ${requireEnv("USER_ADDRESS")} triggered request:    id=${req.requestId}  to=${req.paymentAddress}  amount=${amount}  agentVault=${
                    req.agentVault
                }  reference=${req.paymentReference}  firstBlock=${req.firstUnderlyingBlock}  lastBlock=${req.lastUnderlyingBlock}  lastTimestamp=${
                    req.lastUnderlyingTimestamp
                }\n`;
        }
        logger.info(loggedRequests);
    }

    async redemptionDefault(
        amountUBA: BNish,
        paymentReference: string,
        firstUnderlyingBlock: BNish,
        lastUnderlyingBlock: BNish,
        lastUnderlyingTimestamp: BNish
    ) {
        const redeemer = new Redeemer(this.context, this.nativeAddress, this.underlyingAddress);
        const requestId = PaymentReference.decodeId(paymentReference);
        logger.info(`User ${requireEnv("USER_ADDRESS")} is defaulting redemption ${requestId}.`);
        if (paymentReference !== PaymentReference.redemption(requestId)) {
            logger.error(`User ${requireEnv("USER_ADDRESS")} provided invalid payment reference ${paymentReference} for redemption ${requestId}.`);
            throw new CommandLineError("Invalid payment reference");
        }
        console.log("Waiting for payment default proof...");
        logger.info(`User ${requireEnv("USER_ADDRESS")} is waiting for proof of underlying non payment for redemption ${requestId}.`);
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
            `User ${requireEnv("USER_ADDRESS")} is executing payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} redemption ${requestId}.`
        );
        await redeemer.executePaymentDefault(requestId, proof);
        console.log("Done");
        logger.info(
            `User ${requireEnv("USER_ADDRESS")} executed payment default with proof ${JSON.stringify(web3DeepNormalize(proof))} redemption ${requestId}.`
        );
    }
}
