import {Command} from "commander";
import fs from "fs";
import {AccountSecrets, decryptTestSecrets, isJSON, promptPassword, Wallet} from "./common_utils";
import * as dotenv from 'dotenv';
import {
    BtcAccountGeneration,
    DogeAccountGeneration,
    EncryptionMethod,
    encryptText,
    XrpAccountGeneration
} from "../../src";

dotenv.config();

const program = new Command();
program.name("mainnet-secrets").description("Command line commands for encrypting and generating test secrets files");
program
    .command("encrypt-test-secrets")
    .description("encrypt content of secrets file")
    .action(async () => {
        console.info(process.env.TEST_SECRETS_PATH, process.env.TEST_SECRETS_ENCRYPTED_PATH);
        const secretsPath = process.env.TEST_SECRETS_PATH!;
        const secretsContent = fs.readFileSync(secretsPath).toString();
        if (isJSON(secretsContent)) {
            const secretsPassword = await promptPassword();
            const encryptedSecretsContent = encryptText(secretsPassword, secretsContent, EncryptionMethod.AES_GCM_SCRYPT_AUTH);
            fs.writeFileSync(process.env.TEST_SECRETS_ENCRYPTED_PATH!, encryptedSecretsContent);
            console.log("Secrets file was encrypted.")
        } else {
            console.log("File is not in valid JSON format.");
        }
    });

program
    .command("generate-and-encrypt-stress-test-secrets")
    .description("generate accounts for stress testing BTC, DOGE and XRP")
    .action(async () => {
        const N = 100;
        const xrpWallets = [];
        const btcWallets = [];
        const dogeWallets = [];

        const xrpAccountGeneration = new XrpAccountGeneration(false);
        const btcAccountGeneration = new BtcAccountGeneration(false);
        const dogeAccountGeneration = new DogeAccountGeneration(false);

        for (let i = 0; i < N; i++) {
            const wallet = btcAccountGeneration.createWallet();
            btcWallets.push({
                address: wallet.address,
                mnemonic: wallet.mnemonic,
                private_key: wallet.privateKey
            } as Wallet);
        }

        for (let i = 0; i < N; i++) {
            const wallet = dogeAccountGeneration.createWallet();
            dogeWallets.push({
                address: wallet.address,
                mnemonic: wallet.mnemonic,
                private_key: wallet.privateKey
            } as Wallet);
        }

        for (let i = 0; i < N; i++) {
            const wallet = xrpAccountGeneration.createWallet();
            xrpWallets.push({
                address: wallet.address,
                mnemonic: wallet.mnemonic,
                private_key: wallet.privateKey
            } as Wallet);
        }

        const password = await promptPassword();
        const testSecrets = await decryptTestSecrets(process.env.TEST_SECRETS_ENCRYPTED_PATH!, password) as AccountSecrets;

        const stressTestSecrets = {
            BTC: {
                fundedWallet: testSecrets.BTC.fundedWallet,
                targetWallets: btcWallets
            },
            DOGE: {
                fundedWallet: testSecrets.DOGE.fundedWallet,
                targetWallets: dogeWallets
            },
            XRP: {
                api_key: testSecrets.XRP.api_key,
                fundedWallet: testSecrets.XRP.fundedWallet,
                targetWallets: xrpWallets,
            }
        };

        console.info(`Generate ${N} accounts for BTC, DOGE and XRP`);
        const secretsPassword = await promptPassword(`Enter password for encryption of stress test secrets: `);
        const text = JSON.stringify(stressTestSecrets, null, 4);
        const encryptedSecretsContent = encryptText(secretsPassword, text, EncryptionMethod.AES_GCM_SCRYPT_AUTH);
        fs.writeFileSync(process.env.STRESS_TEST_SECRETS_PATH!, text);
        fs.writeFileSync(process.env.STRESS_TEST_SECRETS_ENCRYPTED_PATH!, encryptedSecretsContent);
    });

program.parse(process.argv);
