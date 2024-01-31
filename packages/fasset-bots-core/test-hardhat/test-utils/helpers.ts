import { AgentBot } from "../../src/actors/AgentBot";
import { AgentBotRunner } from "../../src/actors/AgentBotRunner";
import { Challenger } from "../../src/actors/Challenger";
import { createAgentBotDefaultSettings, decodedChainId, loadAgentSettings } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../src/fasset/Agent";
import { AgentStatus, AssetManagerSettings, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { TrackedState } from "../../src/state/TrackedState";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { BNish, toBN, toBNExp } from "../../src/utils/helpers";
import { requireSecret } from "../../src/config/secrets";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { IERC20Instance } from "../../typechain-truffle";
import { TestAssetBotContext, createTestAssetContext } from "./create-test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import fs from "fs";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Liquidator } from "../../src/actors/Liquidator";
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { Redeemer } from "../../src/mock/Redeemer";
import { TokenPriceReader } from "../../src/state/TokenPrice";
import { InitialAgentData } from "../../src/state/TrackedAgentState";
import { artifacts } from "../../src/utils/web3";
import { MockNotifier } from "../../src/mock/MockNotifier";
import { assert } from "chai";
import BN from "bn.js";

const FakeERC20 = artifacts.require("FakeERC20");
const IERC20 = artifacts.require("IERC20");

const agentUnderlyingAddress: string = "UNDERLYING_ADDRESS";
const redeemerUnderlyingAddress: string = "REDEEMER_UNDERLYING_ADDRESS";
const minterUnderlyingAddress: string = "MINTER_UNDERLYING_ADDRESS";
const depositUSDC = toBNExp(1_000_000, 6);
const depositNat = toBNExp(1_000_000, 18);
const depositUnderlying = toBNExp(1_000_000, 6);
export const DEFAULT_AGENT_SETTINGS_PATH_HARDHAT: string = "./test-hardhat/test-utils/run-config-tests/agent-settings-config-hardhat.json";
export const DEFAULT_POOL_TOKEN_SUFFIX: () => string = () => "POOL-TOKEN-" + Math.floor(Math.random() * 10_000);

export function assertWeb3DeepEqual(x: any, y: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(x), web3DeepNormalize(y), message);
}

export async function createTestAgentBot(
    context: TestAssetBotContext,
    orm: ORM,
    ownerManagementAddress: string,
    ownerUnderlyingAddress?: string,
    notifier: MockNotifier = new MockNotifier(),
    options?: AgentBotDefaultSettings
): Promise<AgentBot> {
    const owner = await Agent.getOwnerAddressPair(context, ownerManagementAddress);
    ownerUnderlyingAddress ??= requireSecret(`owner.${decodedChainId(context.chainInfo.chainId)}.address`);
    await context.blockchainIndexer.chain.mint(ownerUnderlyingAddress, depositUnderlying);
    const underlyingAddress = await AgentBot.createUnderlyingAddress(orm.em, context);
    const addressValidityProof = await AgentBot.inititalizeUnderlyingAddress(context, owner, underlyingAddress);
    const agentBotSettings = options ?? await createAgentBotDefaultSettings(context, loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT));
    agentBotSettings.poolTokenSuffix = DEFAULT_POOL_TOKEN_SUFFIX();
    return await AgentBot.create(orm.em, context, owner, addressValidityProof, agentBotSettings, notifier);
}

export async function mintVaultCollateralToOwner(amount: BNish, vaultCollateralTokenAddress: string, ownerAddress: string): Promise<void> {
    const vaultCollateralToken = await FakeERC20.at(vaultCollateralTokenAddress);
    await vaultCollateralToken.mintAmount(ownerAddress, amount);
}

export async function createTestChallenger(address: string, state: TrackedState): Promise<Challenger> {
    return new Challenger(new ScopedRunner(), address, state, await state.context.blockchainIndexer!.getBlockHeight(), new MockNotifier());
}

export async function createTestLiquidator(address: string, state: TrackedState): Promise<Liquidator> {
    return new Liquidator(new ScopedRunner(), address, state, new MockNotifier());
}

export async function createTestSystemKeeper(address: string, state: TrackedState): Promise<SystemKeeper> {
    return new SystemKeeper(new ScopedRunner(), address, state);
}

export async function createTestAgent(
    context: TestAssetBotContext,
    ownerManagementAddress: string,
    underlyingAddress: string = agentUnderlyingAddress
): Promise<Agent> {
    const owner = await Agent.getOwnerAddressPair(context, ownerManagementAddress);
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT));
    agentBotSettings.poolTokenSuffix = DEFAULT_POOL_TOKEN_SUFFIX();
    const addressValidityProof = await context.attestationProvider.proveAddressValidity(underlyingAddress);
    return await Agent.create(context, owner, addressValidityProof, agentBotSettings);
}

export function createTestAgentBotRunner(
    contexts: Map<string, TestAssetBotContext>,
    orm: ORM,
    loopDelay: number,
    notifier: MockNotifier = new MockNotifier()
): AgentBotRunner {
    return new AgentBotRunner(contexts, orm, loopDelay, notifier);
}

export async function createTestMinter(context: IAssetAgentBotContext, minterAddress: string, chain: MockChain, underlyingAddress: string = minterUnderlyingAddress, amount: BN = depositUnderlying): Promise<Minter> {
    const minter = await Minter.createTest(context, minterAddress, underlyingAddress, amount);
    chain.mine(chain.finalizationBlocks + 1);
    return minter;
}

export async function createTestRedeemer(context: IAssetAgentBotContext, redeemerAddress: string, underlyingAddress: string = redeemerUnderlyingAddress) {
    const redeemer = await Redeemer.create(context, redeemerAddress, underlyingAddress);
    return redeemer;
}

export async function createTestAgentAndMakeAvailable(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string): Promise<Agent> {
    const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
    await mintAndDepositVaultCollateralToOwner(context, agent, depositUSDC, ownerAddress);
    await agent.depositVaultCollateral(depositUSDC);
    await agent.buyCollateralPoolTokens(depositNat);
    await agent.makeAvailable();
    return agent;
}

export async function createTestAgentBAndMakeAvailable(
    context: TestAssetBotContext,
    ownerAddress: string,
    underlyingAddress: string = agentUnderlyingAddress
): Promise<Agent> {
    const agentB = await createTestAgent(context, ownerAddress, underlyingAddress);
    await mintAndDepositVaultCollateralToOwner(context, agentB, depositUSDC, ownerAddress);
    await agentB.depositVaultCollateral(depositUSDC);
    await agentB.buyCollateralPoolTokens(depositNat);
    await agentB.makeAvailable();
    return agentB;
}

export async function createTestAgentBotAndMakeAvailable(
    context: TestAssetBotContext,
    orm: ORM,
    ownerAddress: string,
    ownerUnderlyingAddress?: string,
    notifier: MockNotifier = new MockNotifier(),
    options?: AgentBotDefaultSettings
) {
    const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, notifier, options);
    await mintAndDepositVaultCollateralToOwner(context, agentBot.agent, depositUSDC, agentBot.agent.owner.workAddress);
    await agentBot.agent.depositVaultCollateral(depositUSDC);
    await agentBot.agent.buyCollateralPoolTokens(depositNat);
    await agentBot.agent.makeAvailable();
    return agentBot;
}

export async function mintAndDepositVaultCollateralToOwner( //TODO
    context: IAssetAgentBotContext,
    agent: Agent,
    depositAmount: BNish,
    ownerAddress: string
): Promise<IERC20Instance> {
    const vaultCollateralToken = await agent.getVaultCollateral();
    const vaultCollateralTokenContract = await IERC20.at(vaultCollateralToken.token);
    await mintVaultCollateralToOwner(depositAmount, vaultCollateralToken!.token, ownerAddress);
    return vaultCollateralTokenContract;
}

export async function createTestContext(governance: string, setMaxTrustedPriceAgeSeconds: number) {
    const parameterFilename = `./fasset-config/hardhat/f-${testChainInfo.xrp.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    parameters.maxTrustedPriceAgeSeconds = setMaxTrustedPriceAgeSeconds;
    return await createTestAssetContext(governance, testChainInfo.xrp, undefined, parameters);
}

export async function createCRAndPerformMinting(minter: Minter, vaultAddress: string, lots: number, chain: MockChain) {
    const crt = await minter.reserveCollateral(vaultAddress, lots);
    const txHash0 = await minter.performMintingPayment(crt);
    chain.mine(chain.finalizationBlocks + 1);
    return await minter.executeMinting(crt, txHash0);
}

export async function createCRAndPerformMintingAndRunSteps(minter: Minter, agentBot: AgentBot, lots: number, orm: ORM, chain: MockChain): Promise<void> {
    const crt = await minter.reserveCollateral(agentBot.agent.vaultAddress, lots);
    await agentBot.runStep(orm.em);
    const txHash0 = await minter.performMintingPayment(crt);
    chain.mine(chain.finalizationBlocks + 1);
    await minter.executeMinting(crt, txHash0);
    await agentBot.runStep(orm.em);
}

export async function getAgentStatus(agentBot: AgentBot): Promise<number> {
    const agentInfo = await agentBot.agent.getAgentInfo();
    return Number(agentInfo.status) as AgentStatus;
}

export async function convertFromUSD5(amount: BN, collateralToken: CollateralType, settings: AssetManagerSettings): Promise<BN> {
    const priceReader = await TokenPriceReader.create(settings);
    const stablecoinUSD = await priceReader.getRawPrice(collateralToken.tokenFtsoSymbol, false);
    // 5 is for 5 decimals of USD5
    const expPlus = Number(collateralToken.decimals) + Number(stablecoinUSD.decimals) - 5;
    return toBN(amount).mul(toBNExp(1, expPlus)).div(stablecoinUSD.price);
}

export async function fromAgentInfoToInitialAgentData(agent: Agent): Promise<InitialAgentData> {
    const agentInfo = await agent.getAgentInfo();
    const initialAgentData = {
        owner: agent.owner.managementAddress,
        agentVault: agent.vaultAddress,
        collateralPool: agentInfo.collateralPool,
        underlyingAddress: agent.underlyingAddress,
        vaultCollateralToken: agentInfo.vaultCollateralToken,
        feeBIPS: toBN(agentInfo.feeBIPS),
        poolFeeShareBIPS: toBN(agentInfo.poolFeeShareBIPS),
        mintingVaultCollateralRatioBIPS: toBN(agentInfo.mintingVaultCollateralRatioBIPS),
        mintingPoolCollateralRatioBIPS: toBN(agentInfo.mintingPoolCollateralRatioBIPS),
        buyFAssetByAgentFactorBIPS: toBN(agentInfo.buyFAssetByAgentFactorBIPS),
        poolExitCollateralRatioBIPS: toBN(agentInfo.poolExitCollateralRatioBIPS),
        poolTopupCollateralRatioBIPS: toBN(agentInfo.poolTopupCollateralRatioBIPS),
        poolTopupTokenPriceFactorBIPS: toBN(agentInfo.poolTopupTokenPriceFactorBIPS),
    };
    return initialAgentData;
}
