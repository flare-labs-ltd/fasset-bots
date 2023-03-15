import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";
import * as dotenv from "dotenv";
import fs from "fs";
import { HardhatUserConfig } from "hardhat/config";

dotenv.config();

const accounts = [
    // In Truffle, default account is always the first one.
    ...(process.env.DEPLOYER_PRIVATE_KEY ? [{ privateKey: process.env.DEPLOYER_PRIVATE_KEY, balance: "100000000000000000000000000000000" }] : []),
    ...JSON.parse(fs.readFileSync('test-1020-accounts.json').toString()).slice(0, process.env.TENDERLY == 'true' ? 150 : 2000).filter((x: any) => x.privateKey != process.env.DEPLOYER_PRIVATE_KEY),
    ...(process.env.GENESIS_GOVERNANCE_PRIVATE_KEY ? [{ privateKey: process.env.GENESIS_GOVERNANCE_PRIVATE_KEY, balance: "100000000000000000000000000000000" }] : []),
    ...(process.env.GOVERNANCE_PRIVATE_KEY ? [{ privateKey: process.env.GOVERNANCE_PRIVATE_KEY, balance: "100000000000000000000000000000000" }] : []),
];

const config: HardhatUserConfig = {
    defaultNetwork: "hardhat",

    networks: {
        develop: {
            url: "http://127.0.0.1:9650/ext/bc/C/rpc",
            gas: 10000000,
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        scdev: {
            url: "http://127.0.0.1:9650/ext/bc/C/rpc",
            gas: 8000000,
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        staging: {
            url: process.env.STAGING_RPC || "http://127.0.0.1:9650/ext/bc/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        songbird: {
            url: process.env.SONGBIRD_RPC || "https://songbird-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        flare: {
            url: process.env.FLARE_RPC || "https://flare-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        coston: {
            url: process.env.COSTON_RPC || "https://coston-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        coston2: {
            url: process.env.COSTON2_RPC || "https://coston2-api.flare.network/ext/C/rpc",
            timeout: 40000,
            accounts: accounts.map((x: any) => x.privateKey)
        },
        hardhat: {
            accounts,
            blockGasLimit: 125000000 // 10x ETH gas
        },
        local: {
            url: 'http://127.0.0.1:8545',
            chainId: 31337
        }
    },

    paths: {
        sources: "./contracts/",
        tests: process.env.TEST_PATH || "./test-hardhat/{unit,integration}",
        cache: "./cache",
        artifacts: "./artifacts",
    },

    mocha: {
        timeout: 1000000000
    },
};

export default config;
