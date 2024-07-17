import chalk from "chalk";
import { Secrets } from "../config";
import { closeBotConfig, createBotConfig } from "../config/BotConfig";
import { loadAgentConfigFile } from "../config/config-file-loader";
import { createNativeContext } from "../config/create-asset-context";
import { IAssetNativeChainContext } from "../fasset-bots/IAssetBotContext";
import { TokenExitType } from "../fasset/AssetManagerTypes";
import { assertNotNullCmd } from "../utils/command-line-errors";
import { requiredEventArgs } from "../utils/events/truffle";
import { BNish } from "../utils/helpers";
import { logger } from "../utils/logger";
import { authenticatedHttpProvider, initWeb3 } from "../utils/web3";
import { InfoBotCommands } from "./InfoBotCommands";
import { CleanupRegistration, CollateralPool } from "./UserBotCommands";


export class PoolUserBotCommands {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetNativeChainContext,
        public fAssetSymbol: string,
        public nativeAddress: string
    ) {}

    /**
     * Creates instance of PoolUserBot.
     * @param configFileName path to configuration file
     * @param fAssetSymbol symbol for the fasset
     * @returns instance of UserBot
     */
    static async create(secretsFile: string, configFileName: string, fAssetSymbol: string, registerCleanup?: CleanupRegistration) {
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
        const botConfig = await createBotConfig("common", secrets, configFile, nativeAddress);
        registerCleanup?.(() => closeBotConfig(botConfig));
        // verify fasset config
        const fassetConfig = botConfig.fAssets.get(fAssetSymbol);
        assertNotNullCmd(fassetConfig, `Invalid FAsset symbol ${fAssetSymbol}`);
        const context = await createNativeContext(botConfig, fassetConfig);
        console.error(chalk.cyan("Environment successfully initialized."));
        logger.info(`User ${nativeAddress} successfully finished initializing cli environment.`);
        logger.info(`Asset manager controller is ${context.assetManagerController.address}, asset manager for ${fAssetSymbol} is ${context.assetManager.address}.`);
        return new PoolUserBotCommands(context, fAssetSymbol, nativeAddress);
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

    infoBot(): InfoBotCommands {
        return new InfoBotCommands(this.context);
    }
}
