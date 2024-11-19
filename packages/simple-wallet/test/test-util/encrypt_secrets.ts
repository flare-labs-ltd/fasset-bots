import { Command } from "commander";
import fs from "fs";
import {EncryptionMethod, encryptText} from "./encryption_utils";
import {isJSON, promptPassword} from "./common_utils";
import * as dotenv from 'dotenv';
dotenv.config();

const program = new Command();
program.name("encrypt-test-secrets").description("Command line commands for encrypting test secrets file");

program
    .command("encrypt")
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

program.parse(process.argv);