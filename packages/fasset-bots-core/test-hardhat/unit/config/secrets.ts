import fs from "node:fs";
import { expect, use } from "chai";
import { ChainId, generateSecrets } from "../../../src";
import { ENCRYPTION_PASSWORD_MIN_LENGTH, Secrets } from "../../../src/config/secrets";
import path from "node:path";
import { FASSET_BOT_CONFIG } from "../../../test/test-utils/test-bot-config";
import { sleep, ZERO_ADDRESS } from "../../../src/utils";
import chaiAsPromised from "chai-as-promised";
use(chaiAsPromised);

const chainId = ChainId.testXRP;

describe("Secrets unit tests", () => {
    it("Should not return secret", async () => {
        const secrets = new Secrets("no_file.json", { apiKey: {} });
        const secretName = "wallet";
        const fn = () => {
            return secrets.required(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });

    it("Should not return secret 2", async () => {
        const secrets = new Secrets("no_file.json", { apiKey: {}, owner: { testXRP: { address: "0xabcd", private_key: "0xabcd" } } });
        const address = secrets.required(`owner.${chainId.chainName}.address`);
        const secretName = `owner.${chainId}.address.` + address + "." + address;
        const fn = () => {
            return secrets.required(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });

    it("Should throw error if encryption password too short", async () => {
        const walletPassword = "wallet.encryption_password";
        const secrets = new Secrets("no_file.json", { apiKey: {} });
        const fn1 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn1).to.throw("Secret variable wallet.encryption_password not defined or not typeof string");

        secrets.data.wallet = undefined;
        const fn2 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn2).to.throw("Secret variable wallet.encryption_password not defined or not typeof string");

        secrets.data.wallet = {
            encryption_password: "",
        };
        const fn3 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn3).to.throw(`'wallet.encryption_password' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);

        secrets.data.wallet = {
            encryption_password: "123456789012345",
        };
        const fn4 = () => {
            return secrets.requiredEncryptionPassword(walletPassword);
        };
        expect(fn4).to.throw(`'wallet.encryption_password' should be at least ${ENCRYPTION_PASSWORD_MIN_LENGTH} chars long`);
    });

    function createSecretsFilePath(name: string) {
        const dataPath = "./test-data";
        if (!fs.existsSync(dataPath)) fs.mkdirSync(dataPath, { recursive: true });
        return path.join(dataPath, name);
    }

    it("Should generate and load secrets", async () => {
        const secretsPath = createSecretsFilePath("dummy-secrets.json");
        const secrets = generateSecrets(FASSET_BOT_CONFIG, ["agent", "user", "other"], ZERO_ADDRESS);
        fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 4));
        // chmod 600 (otherwise it will fail)
        const oldALLOW_SECRETS_ON_WINDOWS = process.env.ALLOW_SECRETS_ON_WINDOWS;
        if (process.platform !== "win32") {
            fs.chmodSync(secretsPath, 0o600);
        } else if (process.env.ALLOW_SECRETS_ON_WINDOWS !== "true") {
            process.env.ALLOW_SECRETS_ON_WINDOWS = "true";
        }
        // test
        try {
            const secrets2 = await Secrets.load(secretsPath);
            expect(secrets2.data.apiKey).to.not.be.empty;
        } finally {
            process.env.ALLOW_SECRETS_ON_WINDOWS = oldALLOW_SECRETS_ON_WINDOWS;
        }
    });

    it("Should not load secrets - not chmod 600", async () => {
        const secretsPath = createSecretsFilePath("dummy-secrets-readable.json");
        const secrets = generateSecrets(FASSET_BOT_CONFIG, ["agent", "user", "other"], ZERO_ADDRESS);
        fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 4));
        // make it fail on windows
        const oldALLOW_SECRETS_ON_WINDOWS = process.env.ALLOW_SECRETS_ON_WINDOWS;
        process.env.ALLOW_SECRETS_ON_WINDOWS = undefined;
        // test
        try {
            const promise = Secrets.load(secretsPath);
            if (process.platform !== "win32") {
                await expect(promise).to.eventually.be.rejectedWith(/File .* must only be readable by the process user\. Set permission bits to 600\./);
            } else {
                await expect(promise).to.eventually.be.rejectedWith(/Cannot reliably check secrets file permissions on Windows\..*/);
            }
        } finally {
            process.env.ALLOW_SECRETS_ON_WINDOWS = oldALLOW_SECRETS_ON_WINDOWS;
        }
    });
});
