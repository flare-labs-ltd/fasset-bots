import { BlockchainWalletHelper, ChainId, UserBotCommands } from "../../src";
import { Redeemer } from "../../src/mock/Redeemer";
import { logger, sendWeb3Transaction, toStringExp, web3 } from "../../src/utils";
import * as simpleWallet from "@flarelabs/simple-wallet";
import { Minter } from "../../src/mock/Minter";
import { BTC_TEST_ACCOUNTS} from "./btc_test_accounts";
import { FLR_TEST_ACCOUNTS} from "./flr_test_accounts";
import {
    BotConfigFile, createBlockchainWalletHelper,
    createBotOrm,
    loadConfigFile, Secrets,
    SecretsFile,
} from "../../src/config";
import { toBN } from "web3-utils";
import winston from "winston";
import fs from "node:fs";
import BN from "bn.js";

const BTCFundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";
const BTCFundedPrivateKey = "cQTqCyHAPJdg2Aej1Xfw7RN5tck3G9L5udKm2rU4rSJ4WLtrCr5K"

const FLRfundedAddress = "";
const FLRfundedPrivateKey = "";
let blockchainWalletHelper: BlockchainWalletHelper;

describe("Fast minting", function (){

    const N = 15;
    const amountToSend = toBN(1_000_000);
    const AGENT_ADDRESS = "0x3e3b0F3180d14F82f8f2fd6061F4C76df275C212";

    const MINT_N_LOTS = 1;
    const REDEEM_N_LOTS = 1;

    const TEST_FASSET_BOT_CONFIG = '../../test-data/extend-coston.json';
    const FASSET_BOT_SECRETS = '../../secrets.json';
    const FASSET_USER_DATA_DIR = "../../user-data";


    before(async () => {
        addConsoleTransportForTests(logger);
        addConsoleTransportForTests(simpleWallet.logger);

        const botConfigFile = loadConfigFile(TEST_FASSET_BOT_CONFIG!);
        blockchainWalletHelper = await setupWallet(botConfigFile, createUserSecrets(FLRfundedAddress, FLRfundedPrivateKey, BTCFundedAddress, BTCFundedPrivateKey));
        await blockchainWalletHelper.addExistingAccount(BTCFundedAddress, BTCFundedPrivateKey);
        void blockchainWalletHelper.startMonitoringTransactionProgress();
    });

    after(async () => {
        await blockchainWalletHelper.stopMonitoring();
    })

    it.skip("Fund accounts", async function() {
        this.timeout(15 * 60 * 1000);
        await Promise.all(BTC_TEST_ACCOUNTS.slice(0, N).map(async acc => {
            await blockchainWalletHelper.addTransactionAndWaitForItsFinalization(BTCFundedAddress, acc.address, amountToSend, "test");
        }));
    });

    it("Fast minting and redeeming", async function() {
        this.timeout(80 * 60 * 1000); // 90min

        if (!(N >= 1)) throw new Error("Missing or invalid arg N");
        if (N > BTC_TEST_ACCOUNTS.length) throw new Error("N should not be greater than number of test accounts");

        const parent = await UserBotCommands.create(FASSET_BOT_SECRETS!, TEST_FASSET_BOT_CONFIG!, "FTestBTC", FASSET_USER_DATA_DIR!);
        const redeemers: Redeemer[] = [];
        const minters: Minter[] = [];

        const lotSize = await parent.context.assetManager.lotSize();
        logger.info(`LOT SIZE: ${lotSize.toNumber()}`);

        for (let i = 0; i < N; i++) {
            try {
                const FLRAccount = web3.eth.accounts.privateKeyToAccount(FLR_TEST_ACCOUNTS[i].privateKey);
                web3.eth.accounts.wallet.add(FLRAccount);
                const BTCAccount = BTC_TEST_ACCOUNTS[i];
                await blockchainWalletHelper.addExistingAccount(BTCAccount.address, BTCAccount.privateKey);

                const redeemer = new Redeemer(parent.context, FLRAccount.address, BTCAccount.address);
                const minter = new Minter(parent.context, FLRAccount.address, BTCAccount.address, blockchainWalletHelper);

                minters.push(minter);
                redeemers.push(redeemer);

                console.log(`Created minter ${i} at address ${minter.address}`);
                console.log(`Created redeemer ${i} at address ${redeemer.address}`);

                await sendWeb3Transaction({ from: parent.nativeAddress, to: FLRAccount.address, value: toStringExp(5, 18), gas: 100_000 });
            } catch (error) {
                console.error(`Error while preparing for minting: ${errorMessage(error)}`);
            }
        }

        logger.info("STARTING MINTING");
        await Promise.all(minters.map(async (minter, i) => {
            try {
                const crt = await minter.reserveCollateral(AGENT_ADDRESS, MINT_N_LOTS);
                const txHash = await minter.performMintingPayment(crt);
                await minter.executeMinting(crt, txHash);
            } catch (error) {
                logger.error(`Error while minting from minter ${i} at address ${minter.address}: ${errorMessage(error)}`);
            }
        }));

        logger.info("STARTING REDEEMING");
        await Promise.all(redeemers.map(async (redeemer, i) => {
            try {
                console.log(`Redeeming 1 lot by redeemer ${i} at ${redeemer.address}`);
                await redeemer.requestRedemption(REDEEM_N_LOTS);
            } catch (error) {
                console.error(`Error while reedming from redeemer ${i} at address ${redeemer.address}: ${errorMessage(error)}`);
            }
        }));
    });

    it.only("monitoring into inf", async () => {
        while (true) {
            await sleepMs(2000);
        }
    });

    it.skip("Create web3 accounts", async () => {

        const accounts= [];
        for (let i = 0; i < 100; i++) {
            const account = web3.eth.accounts.create();
            accounts.push({
                address: account.address,
                privateKey: account.privateKey,
            });
        }

        const fileContent = `export const FLR_TEST_ACCOUNTS = ${JSON.stringify(accounts, null, 4)};\n`;
        fs.writeFileSync("./flr_test_accounts.ts", fileContent, 'utf-8');
    });
});

export async function sleepMs(ms: number) {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}

async function setupWallet(config: BotConfigFile, secrets: Secrets) {
    const orm = await createBotOrm("user", config.ormOptions, secrets.data.database);
    if (!orm) {
        throw new Error(`Undefined orm`);
    }
    const chainId = ChainId.testBTC;
    return await  createBlockchainWalletHelper(secrets, chainId, orm.em, "https://testbtc.indexers.flare.space/api/v2", "blockbook", config.walletOptions);
}

async function fundAccounts(N: number, amountToSend: BN) {
    await Promise.all(BTC_TEST_ACCOUNTS.slice(0, N).map(async acc => {
        await blockchainWalletHelper.addTransactionAndWaitForItsFinalization(BTCFundedAddress, acc.address, amountToSend, "test");
    }));
}

function createUserSecrets(nativeAddress: string, nativePrivateKey: string, underlyingAddress: string, underlyingPrivateKey: string) {
    const secrets: SecretsFile = {
        apiKey: {
            indexer: "",
        },
        user: {
            native: {
                address: nativeAddress,
                private_key: nativePrivateKey,
            },
            testBTC: {
                address: underlyingAddress,
                private_key: underlyingPrivateKey,
            }
        },
        wallet: {
            encryption_password: "np2qU6AGutPaaaEdbbbUkfzcccLeWxjEi5"
        },
        database: {
            user: "root",
            password: "root_password",
        }
    };

    return new Secrets("MEMORY", secrets);
}

function addConsoleTransportForTests (logger: any) {
    const consoleTransport = new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        ),
    });

    logger.add(consoleTransport);

    return () => {
        logger.remove(consoleTransport);
    };
}

function errorMessage(e: any) {
    return e instanceof Error ? `${e.name} - ${e.message}: \n ${e.stack}` : e;
}
