import "dotenv/config";
import "source-map-support/register";

import { Command } from "commander";
import { loadConfigFile } from "../config/BotConfig";
import { loadContracts } from "../config/contracts";
import { BNish, requireEnv, requireNotNull, toplevelRun } from "../utils/helpers";
import { artifacts, authenticatedHttpProvider, initWeb3 } from "../utils/web3";

const FakeERC20 = artifacts.require("FakeERC20");
const Whitelist = artifacts.require("Whitelist");

const deployerAddress = requireEnv("DEPLOY_ADDRESS");

async function whitelistAgent(configFileName: string, ownerAddress: string) {
    const config = await initEnvironment(configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const agentWhitelist = await Whitelist.at(contracts["AgentWhitelist"]!.address);
    await agentWhitelist.addAddressesToWhitelist([ownerAddress], { from: deployerAddress });
}

async function mintFakeTokens(configFileName: string, tokenSymbol: string, recipientAddress: string, amount: BNish): Promise<void> {
    const config = await initEnvironment(configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const tokenAddres = requireNotNull(contracts[tokenSymbol]).address;
    const token = await FakeERC20.at(tokenAddres);
    await token.mintAmount(recipientAddress, amount, { from: deployerAddress });
}

async function initEnvironment(configFile: string) {
    const config = loadConfigFile(configFile);
    const nativePrivateKey = requireEnv("DEPLOY_PRIVATE_KEY");
    const accounts = await initWeb3(authenticatedHttpProvider(config.rpcUrl, process.env.NATIVE_RPC_API_KEY), [nativePrivateKey], null);
    if (deployerAddress !== accounts[0]) {
        throw new Error("Invalid address/private key pair");
    }
    return config;
}

const program = new Command();

program.addOption(program.createOption("-c, --config <configFile>", "Config file path (REQUIRED)").makeOptionMandatory(true));

program
    .command("whitelistAgent")
    .description("allow agent owner address to operate")
    .argument("address", "owner's address")
    .action(async (address: string) => {
        const options: { config: string } = program.opts();
        await whitelistAgent(options.config, address);
    });

program
    .command("mintFakeTokens")
    .description("mint fake tokens (fake versions of USDC or USDT on test networks)")
    .argument("symbol", "fake token symbol, e.g. USDC or USDT")
    .argument("address", "recipient's address")
    .argument("amount", "amount in WEI")
    .action(async (symbol: string, address: string, amount: string) => {
        const options: { config: string } = program.opts();
        await mintFakeTokens(options.config, symbol, address, amount);
    });

toplevelRun(async () => {
    await program.parseAsync();
});
