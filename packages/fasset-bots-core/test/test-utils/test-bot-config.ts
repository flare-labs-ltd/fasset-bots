export const TEST_FASSET_BOT_CONFIG = process.env.TEST_FASSET_BOT_CONFIG ?? "./run-config/coston-bot.json";
export const FASSET_BOT_CONFIG = process.env.FASSET_BOT_CONFIG ?? "./run-config/coston-bot.json";
export const TEST_SECRETS = process.env.FASSET_BOT_SECRETS ?? "./secrets.json";

export const OWNER_ADDRESS: string = "0xbaDC368bdCf8BB41FFF844bCF34a41968BdCe073";
export const COSTON_RPC: string = "https://coston-api.flare.network/ext/C/rpc";
export const COSTON_RUN_CONFIG_CONTRACTS = "./run-config/coston-bot.json";
export const COSTON_TEST_AGENT_SETTINGS = "./test/test-utils/run-config-test/agent-settings-config-test.json";
export const COSTON_RUN_CONFIG_ADDRESS_UPDATER = "./test/test-utils/run-config-test/run-config-coston-with-address-updater.json";
export const COSTON_SIMPLIFIED_RUN_CONFIG_CONTRACTS = "./test/test-utils/run-config-test/run-simplified-config-coston-with-contracts.json";
export const COSTON_SIMPLIFIED_RUN_CONFIG_ADDRESS_UPDATER = "./test/test-utils/run-config-test/run-simplified-config-coston-with-address-updater.json";
export const AGENT_DEFAULT_CONFIG_PATH = "./run-config/agent-settings-config.json";
export const COSTON_CONTRACTS_MISSING_SC = "./test/test-utils/run-config-test/contracts-missing-sc.json";
export const COSTON_CONTRACTS_MISSING_VERIFIER = "./test/test-utils/run-config-test/contracts-missing-verifier.json";
export const COSTON_CONFIG_EXTENDS_1 = "./test/test-utils/run-config-test/run-config-extend-coston-1.json";
export const COSTON_CONFIG_EXTENDS_2 = "./test/test-utils/run-config-test/run-config-extend-coston-2.json";
export const COSTON_CONFIG_LOOP_1 = "./test/test-utils/run-config-test/run-config-extend-loop-1.json";
export const COSTON_CONFIG_INVALID = "./test/test-utils/run-config-test/run-config-coston-invalid.json";

export const INDEXER_URL_XRP: string[] = [
    "https://testnet-verifier-fdc-test.aflabs.org/verifier/xrp",
    "https://testnet-verifier-fdc-test.aflabs.org/verifier/xrp"
];

export const INDEXER_URL_BTC: string[] = [
    "https://testnet-verifier-fdc-test.aflabs.org/verifier/btc"
];

export const INDEXER_URL_DOGE: string[] = [
    "https://testnet-verifier-fdc-test.aflabs.org/verifier/doge"
];

export const DATA_ACCESS_LAYER_URLS: string[] = [
    "https://da.cflr.testfsp.aflabs.org:4443",
    "https://da.cflr.testfsp.aflabs.org:4443",
];

export const FDC_VERIFICATION_ADDRESS: string = "0x6Bd0DBbDB84F667d5C450E517760375c8Ad8De71";
export const RELAY_ADDRESS: string = "0x92a6E1127262106611e1e129BB64B6D8654273F7";
export const FDC_HUB_ADDRESS: string = "0x1c78A073E3BD2aCa4cc327d55FB0cD4f0549B55b";
