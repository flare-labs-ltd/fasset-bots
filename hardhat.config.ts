import "dotenv/config";

import "@nomiclabs/hardhat-web3";
import fs from "fs";
import { globSync } from "glob";
import { TASK_TEST_GET_TEST_FILES } from 'hardhat/builtin-tasks/task-names';
import { HardhatUserConfig, task } from "hardhat/config";
import path from "path";
import { TraceManager } from "@flarenetwork/mcc";

// disable MCC trace manager in hardhat tests
TraceManager.enabled = false;

// allow glob patterns in test file args
task(TASK_TEST_GET_TEST_FILES, async ({ testFiles }: { testFiles: string[] }, { config }) => {
    const cwd = process.cwd();
    if (testFiles.length === 0) {
        const testPath = path.relative(cwd, config.paths.tests).replace(/\\/g, '/');    // glob doesn't work with windows paths
        testFiles = [testPath + '/**/*.{js,ts}'];
    }
    return testFiles.flatMap(pattern => globSync(pattern) as string[])
        .map(fname => path.resolve(cwd, fname));
});

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
            chainId: 31337,
            accounts: accounts.map((x: any) => x.privateKey)
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
