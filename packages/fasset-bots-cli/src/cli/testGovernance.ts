import "dotenv/config";
import "source-map-support/register";

import { CollateralClass, CollateralType } from "@flarelabs/fasset-bots-core";
import { ChainContracts, getSecrets, loadConfigFile, loadContracts, requireSecret } from "@flarelabs/fasset-bots-core/config";
import { AssetManagerControllerInstance } from "@flarelabs/fasset-bots-core/types";
import { artifacts, authenticatedHttpProvider, initWeb3, requireNotNull, toBN, toBNExp, toplevelRun } from "@flarelabs/fasset-bots-core/utils";
import { readFileSync } from "fs";
import { programWithCommonOptions } from "../utils/program";

const FakeERC20 = artifacts.require("FakeERC20");
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");
const AssetManagerController = artifacts.require("AssetManagerController");

const program = programWithCommonOptions("bot", "all_fassets");

program.name("test-governance").description("Command line commands for governance operation (not in production mode)");

program
    .command("whitelistAgent")
    .description("allow agent owner address to operate")
    .argument("address", "owner's address")
    .argument("name", "owner's name")
    .argument("description", "owner's description")
    .argument("[iconUrl]", "owner's icon url")
    .action(async (address: string, name: string, description: string, iconUrl?: string) => {
        const options: { config: string } = program.opts();
        await whitelistAndDescribeAgent(options.config, address, name, description, iconUrl ?? "");
    });

program
    .command("isAgentWhitelisted")
    .description("check if agent owner address is whitelisted")
    .argument("address", "owner's address")
    .action(async (address: string) => {
        const options: { config: string } = program.opts();
        const isWhitelisted = await isAgentWhitelisted(options.config, address);
        console.log(isWhitelisted);
    });

program
    .command("mintFakeTokens")
    .description("mint fake tokens (fake versions of USDC or USDT on test networks)")
    .argument("symbol", "fake token symbol, e.g. testUSDC or testUSDT")
    .argument("address", "recipient's address")
    .argument("amount", "amount (token)")
    .action(async (symbol: string, address: string, amount: string) => {
        const options: { config: string } = program.opts();
        await mintFakeTokens(options.config, symbol, address, amount);
    });

program
    .command("addCollateralToken")
    .description("add new collateral token to all asset managers")
    .argument("paramFile", "parameter file in JSON format")
    .action(async (paramFile: string) => {
        const options: { config: string } = program.opts();
        await addCollateralToken(options.config, paramFile);
    });

program
    .command("deprecateCollateralToken")
    .description("deprecate collateral token (on all asset managers)")
    .argument("tokenAddress", "token address")
    .action(async (tokenAddress: string) => {
        const options: { config: string } = program.opts();
        const deployerAddress = requireSecret("deployer.address");
        await runOnAssetManagerController(options.config, async (controller, managers) => {
            await controller.deprecateCollateralType(managers, CollateralClass.VAULT, tokenAddress, 86400, { from: deployerAddress });
        });
    });

toplevelRun(async () => {
    await program.parseAsync();
});

async function whitelistAndDescribeAgent(configFileName: string, ownerAddress: string, name: string, description: string, iconUrl: string) {
    const config = await initEnvironment(configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const deployerAddress = requireSecret("deployer.address");
    const agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry.address);
    await agentOwnerRegistry.whitelistAndDescribeAgent(ownerAddress, name, description, iconUrl, { from: deployerAddress });
}

async function isAgentWhitelisted(configFileName: string, ownerAddress: string): Promise<boolean> {
    const config = await initEnvironment(configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry.address);
    return agentOwnerRegistry.isWhitelisted(ownerAddress);
}

async function mintFakeTokens(configFileName: string, tokenSymbol: string, recipientAddress: string, amount: string): Promise<void> {
    const config = await initEnvironment(configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const deployerAddress = requireSecret("deployer.address");
    const tokenAddres = requireNotNull(contracts[tokenSymbol]).address;
    const token = await FakeERC20.at(tokenAddres);
    const decimals = Number(await token.decimals());
    const amountBN = toBNExp(amount, decimals);
    await token.mintAmount(recipientAddress, amountBN, { from: deployerAddress });
}

async function runOnAssetManagerController(configFileName: string, method: (controller: AssetManagerControllerInstance, assetManagers: string[]) => Promise<void>) {
    const config = await initEnvironment(configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const controller = await AssetManagerController.at(contracts.AssetManagerController.address);
    const assetManagers = await controller.getAssetManagers();
    return await method(controller, assetManagers);
}

async function addCollateralToken(configFileName: string, paramFile: string) {
    const config = await initEnvironment(configFileName);
    const contracts = loadContracts(requireNotNull(config.contractsJsonFile));
    const deployerAddress = requireSecret("deployer.address");
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

async function initEnvironment(configFile: string) {
    const config = loadConfigFile(configFile);
    const deployerAddress = requireSecret("deployer.address");
    const nativePrivateKey = requireSecret("deployer.private_key");
    const accounts = await initWeb3(authenticatedHttpProvider(config.rpcUrl, getSecrets().apiKey.native_rpc), [nativePrivateKey], null);
    if (deployerAddress !== accounts[0]) {
        throw new Error("Invalid address/private key pair");
    }
    return config;
}
