import "dotenv/config";
import "source-map-support/register";

import { CollateralClass, CollateralType } from "@flarelabs/fasset-bots-core";
import { ChainContracts, Secrets, loadConfigFile, loadContracts } from "@flarelabs/fasset-bots-core/config";
import { AssetManagerControllerInstance } from "@flarelabs/fasset-bots-core/types";
import { artifacts, authenticatedHttpProvider, initWeb3, requireNotNull, requireNotNullCmd, toBNExp } from "@flarelabs/fasset-bots-core/utils";
import type { OptionValues } from "commander";
import { readFileSync } from "fs";
import { OpenBetaAgentRegistrationTransport } from "../utils/open-beta";
import { programWithCommonOptions } from "../utils/program";
import { toplevelRun } from "../utils/toplevel";
import { validateAddress, validateDecimal } from "../utils/validation";

const FakeERC20 = artifacts.require("FakeERC20");
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");
const Whitelist = artifacts.require("Whitelist");
const AssetManagerController = artifacts.require("AssetManagerController");

const program = programWithCommonOptions("util", "all_fassets");

program.name("test-governance").description("Command line commands for governance operation (not in production mode)");

program
    .command("whitelistAgent")
    .description("allow agent owner to operate")
    .argument("address", "owner management address")
    .argument("name", "owner's name")
    .argument("description", "owner's description")
    .argument("[iconUrl]", "owner's icon url")
    .action(async (address: string, name: string, description: string, iconUrl?: string) => {
        const options: { config: string; secrets: string } = program.opts();
        await whitelistAndDescribeAgent(options.secrets, options.config, address, name, description, iconUrl ?? "");
    });

program
    .command("isAgentWhitelisted")
    .description("check if agent owner address is whitelisted")
    .argument("address", "owner's address")
    .action(async (address: string) => {
        const options: { config: string; secrets: string } = program.opts();
        const isWhitelisted = await isAgentWhitelisted(options.secrets, options.config, address);
        console.log(isWhitelisted);
    });

program
    .command("whitelistUser")
    .description("allow agent owner to operate")
    .argument("address", "owner management address")
    .action(async (address: string) => {
        const options: { config: string; secrets: string } = program.opts();
        await whitelistUser(options.secrets, options.config, address);
    });

program
    .command("mintFakeTokens")
    .description("mint fake tokens (fake versions of USDC or USDT on test networks)")
    .argument("symbol", "fake token symbol, e.g. testUSDC or testUSDT")
    .argument("address", "recipient's address")
    .argument("amount", "amount (token)")
    .action(async (symbol: string, address: string, amount: string) => {
        const options: { config: string; secrets: string } = program.opts();
        await mintFakeTokens(options.secrets, options.config, symbol, address, amount);
    });

program
    .command("addCollateralToken")
    .description("add new collateral token to all asset managers")
    .argument("paramFile", "parameter file in JSON format")
    .action(async (paramFile: string) => {
        const options: { config: string; secrets: string } = program.opts();
        await addCollateralToken(options.secrets, options.config, paramFile);
    });

program
    .command("deprecateCollateralToken")
    .description("deprecate collateral token (on all asset managers)")
    .argument("tokenAddress", "token address")
    .action(async (tokenAddress: string) => {
        const options: { config: string; secrets: string } = program.opts();
        const secrets = Secrets.load(options.secrets);
        const deployerAddress = secrets.required("deployer.address");
        await runOnAssetManagerController(options.secrets, options.config, async (controller, managers) => {
            await controller.deprecateCollateralType(managers, CollateralClass.VAULT, tokenAddress, 86400, { from: deployerAddress });
        });
    });

program
    .command("openBetaAgentRegister")
    .description("whitelist and fund agents with CFLR and fake collateral tokens (used for open-beta)")
    .option("--usdc <amountUsdc>", "amount of testUSDC tokens minted to each user", "0")
    .option("--usdt <amountUsdt>", "amount of testUSDT tokens minted to each user", "0")
    .option("--eth <amountEth>", "amount of testETH tokens minted to each user", "0")
    .action(async (_options: OptionValues) => {
        const options: { config: string; secrets: string } = program.opts();
        const registrationApi = new OpenBetaAgentRegistrationTransport(Secrets.load(options.secrets));
        const unFundedAgents = await registrationApi.getUnfundedAgents();
        for (const agent of unFundedAgents) {
            try {
                await whitelistAndDescribeAgent(options.secrets, options.config, agent.management_address, agent.tg_user_name, agent.description, agent.icon_url);
                if (Number(_options.usdc) >= 0) {
                    await mintFakeTokens(options.secrets, options.config, "testUSDC", agent.management_address, _options.usdc);
                }
                if (Number(_options.usdt) >= 0) {
                    await mintFakeTokens(options.secrets, options.config, "testUSDT", agent.management_address, _options.usdt);
                }
                if (Number(_options.eth) >= 0) {
                    await mintFakeTokens(options.secrets, options.config, "testETH", agent.management_address, _options.eth);
                }
                await registrationApi.confirmFundedAgent(agent.management_address);
            } catch (e) {
                console.error(`Error with handling agent ${agent.tg_user_name}: ${e}`);
            }
        }
    });

toplevelRun(async () => {
    await program.parseAsync();
});

async function whitelistAndDescribeAgent(secretsFile: string, configFileName: string, managementAddress: string, name: string, description: string, iconUrl: string) {
    const [secrets, config] = await initEnvironment(secretsFile, configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const deployerAddress = secrets.required("deployer.address");
    const agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry.address);
    await agentOwnerRegistry.whitelistAndDescribeAgent(managementAddress, name, description, iconUrl, { from: deployerAddress });
}

async function isAgentWhitelisted(secretsFile: string, configFileName: string, ownerAddress: string): Promise<boolean> {
    const [_secrets, config] = await initEnvironment(secretsFile, configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry.address);
    return agentOwnerRegistry.isWhitelisted(ownerAddress);
}

async function whitelistUser(secretsFile: string, configFileName: string, address: string) {
    const [secrets, config] = await initEnvironment(secretsFile, configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const deployerAddress = secrets.required("deployer.address");
    const userWhitelist = await Whitelist.at(contracts.AgentOwnerRegistry.address);
    await userWhitelist.addAddressToWhitelist(address, { from: deployerAddress });
}

async function mintFakeTokens(secretsFile: string, configFileName: string, tokenSymbol: string, recipientAddress: string, amount: string): Promise<void> {
    const [secrets, config] = await initEnvironment(secretsFile, configFileName);
    validateDecimal(amount, "Invalid amount");
    validateAddress(recipientAddress, `Invalid recipient address ${recipientAddress}`);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const deployerAddress = secrets.required("deployer.address");
    const tokenAddres = requireNotNullCmd(contracts[tokenSymbol], `Invalid token symbol ${tokenSymbol}`).address;
    const token = await FakeERC20.at(tokenAddres);
    const decimals = Number(await token.decimals());
    const amountBN = toBNExp(amount, decimals);
    await token.mintAmount(recipientAddress, amountBN, { from: deployerAddress });
}

async function runOnAssetManagerController(secretsFile: string, configFileName: string, method: (controller: AssetManagerControllerInstance, assetManagers: string[]) => Promise<void>) {
    const [_secrets, config] = await initEnvironment(secretsFile, configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const controller = await AssetManagerController.at(contracts.AssetManagerController.address);
    const assetManagers = await controller.getAssetManagers();
    return await method(controller, assetManagers);
}

async function addCollateralToken(secretsFile: string, configFileName: string, paramFile: string) {
    const [secrets, config] = await initEnvironment(secretsFile, configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const deployerAddress = secrets.required("deployer.address");
    const parameters = JSON.parse(readFileSync(paramFile).toString());
    const collateralType: CollateralType = {
        collateralClass: CollateralClass.VAULT,
        token: addressFromParameter(contracts, parameters.token),
        decimals: parameters.decimals,
        validUntil: 0, // not deprecated
        directPricePair: parameters.directPricePair,
        assetFtsoSymbol: parameters.assetFtsoSymbol,
        tokenFtsoSymbol: parameters.tokenFtsoSymbol,
        minCollateralRatioBIPS: parameters.minCollateralRatioBIPS,
        ccbMinCollateralRatioBIPS: parameters.ccbMinCollateralRatioBIPS,
        safetyMinCollateralRatioBIPS: parameters.safetyMinCollateralRatioBIPS,
    };
    const controller = await AssetManagerController.at(contracts.AssetManagerController.address);
    const assetManagers = await controller.getAssetManagers();
    await controller.addCollateralType(assetManagers, collateralType, { from: deployerAddress });
}

function addressFromParameter(contracts: ChainContracts, addressOrName: string) {
    if (addressOrName.startsWith("0x")) return addressOrName;
    const contract = contracts[addressOrName];
    if (contract != null) return contract.address;
    throw new Error(`Missing contract ${addressOrName}`);
}

async function initEnvironment(secretsFile: string, configFile: string) {
    const secrets = Secrets.load(secretsFile);
    const config = loadConfigFile(configFile);
    const deployerAddress = secrets.required("deployer.address");
    const nativePrivateKey = secrets.required("deployer.private_key");
    const accounts = await initWeb3(authenticatedHttpProvider(config.rpcUrl, secrets.optional("apiKey.native_rpc")), [nativePrivateKey], null);
    if (deployerAddress !== accounts[0]) {
        throw new Error("Invalid address/private key pair");
    }
    return [secrets, config] as const;
}
