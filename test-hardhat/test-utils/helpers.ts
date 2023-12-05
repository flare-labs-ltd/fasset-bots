import assert from "node:assert";
import { AgentBot } from "../../src/actors/AgentBot";
import { AgentBotRunner } from "../../src/actors/AgentBotRunner";
import { Challenger } from "../../src/actors/Challenger";
import { createAgentBotDefaultSettings, decodedChainId } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../src/fasset/Agent";
import { AgentStatus, AssetManagerSettings, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { TrackedState } from "../../src/state/TrackedState";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { BNish, toBN, toBNExp } from "../../src/utils/helpers";
import { Notifier } from "../../src/utils/Notifier";
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
import { requireSecret } from "../../src/config/secrets";
import { SourceId } from "../../src/underlying-chain/SourceId";

const ERC20Mock = artifacts.require("ERC20Mock");
const IERC20 = artifacts.require("IERC20");

const agentUnderlyingAddress: string = "UNDERLYING_ADDRESS";
const redeemerUnderlyingAddress: string = "REDEEMER_UNDERLYING_ADDRESS";
const minterUnderlyingAddress: string = "MINTER_UNDERLYING_ADDRESS";
const deposit = toBNExp(1_000_000, 18);
const depositUnderlying = toBNExp(100_000, 6);
export const DEFAULT_AGENT_SETTINGS_PATH_HARDHAT: string = "./test-hardhat/test-utils/run-config-tests/agent-settings-config-hardhat.json";
export const DEFAULT_POOL_TOKEN_SUFFIX: () => string = () => "POOL-TOKEN-" + Math.floor(Math.random() * 10_000);

export function assertWeb3DeepEqual(x: any, y: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(x), web3DeepNormalize(y), message);
}

export async function createTestAgentBot(
    context: TestAssetBotContext,
    orm: ORM,
    ownerAddress: string,
    ownerUnderlyingAddress?: string,
    notifier: Notifier = new Notifier(),
    options?: AgentBotDefaultSettings
): Promise<AgentBot> {
    const underlyingAddress = ownerUnderlyingAddress ? ownerUnderlyingAddress : requireSecret(`owner.${decodedChainId(context.chainInfo.chainId)}.address`);
    await context.blockchainIndexer.chain.mint(underlyingAddress, depositUnderlying);
    const agentBotSettings: AgentBotDefaultSettings = options
        ? options
        : await createAgentBotDefaultSettings(context, DEFAULT_AGENT_SETTINGS_PATH_HARDHAT, DEFAULT_POOL_TOKEN_SUFFIX());
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, notifier);
}

export async function mintVaultCollateralToOwner(amount: BNish, vaultCollateralTokenAddress: string, ownerAddress: string): Promise<void> {
    const vaultCollateralToken = await ERC20Mock.at(vaultCollateralTokenAddress);
    await vaultCollateralToken.mintAmount(ownerAddress, amount);
}

export async function createTestChallenger(address: string, state: TrackedState): Promise<Challenger> {
    return new Challenger(new ScopedRunner(), address, state, await state.context.blockchainIndexer!.getBlockHeight());
}

export async function createTestLiquidator(address: string, state: TrackedState): Promise<Liquidator> {
    return new Liquidator(new ScopedRunner(), address, state);
}

export async function createTestSystemKeeper(address: string, state: TrackedState): Promise<SystemKeeper> {
    return new SystemKeeper(new ScopedRunner(), address, state);
}

export async function createTestAgentB(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string = agentUnderlyingAddress): Promise<Agent> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(
        context,
        DEFAULT_AGENT_SETTINGS_PATH_HARDHAT,
        DEFAULT_POOL_TOKEN_SUFFIX()
    );
    const agentSettings = { underlyingAddressString: underlyingAddress, ...agentBotSettings };
    return await Agent.create(context, ownerAddress, agentSettings);
}

export async function createTestAgent(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string = agentUnderlyingAddress, suffix: string = DEFAULT_POOL_TOKEN_SUFFIX()): Promise<Agent> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(
        context,
        DEFAULT_AGENT_SETTINGS_PATH_HARDHAT,
        suffix
    );
    const agentSettings = { underlyingAddressString: underlyingAddress, ...agentBotSettings };
    return await Agent.create(context, ownerAddress, agentSettings);
}

export function createTestAgentBotRunner(
    contexts: Map<string, TestAssetBotContext>,
    orm: ORM,
    loopDelay: number,
    notifier: Notifier = new Notifier()
): AgentBotRunner {
    return new AgentBotRunner(contexts, orm, loopDelay, notifier);
}

export async function createTestMinter(context: IAssetAgentBotContext, minterAddress: string, chain: MockChain, underlyingAddress: string = minterUnderlyingAddress, amount: BN = deposit): Promise<Minter> {
    const minter = await Minter.createTest(context, minterAddress, underlyingAddress, amount);
    chain.mine(chain.finalizationBlocks + 1);
    return minter;
}

export async function createTestRedeemer(context: IAssetAgentBotContext, redeemerAddress: string, underlyingAddress: string = redeemerUnderlyingAddress) {
    const redeemer = await Redeemer.create(context, redeemerAddress, underlyingAddress);
    return redeemer;
}

export async function createTestAgentAndMakeAvailable(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string, suffix: string = DEFAULT_POOL_TOKEN_SUFFIX()): Promise<Agent> {
    const agent = await createTestAgent(context, ownerAddress, underlyingAddress, suffix);
    await mintAndDepositVaultCollateralToOwner(context, agent, deposit, ownerAddress);
    await agent.depositVaultCollateral(deposit);
    await agent.buyCollateralPoolTokens(deposit);
    await agent.makeAvailable();
    return agent;
}

export async function createTestAgentBAndMakeAvailable(
    context: TestAssetBotContext,
    ownerAddress: string,
    underlyingAddress: string = agentUnderlyingAddress
): Promise<Agent> {
    const agentB = await createTestAgentB(context, ownerAddress, underlyingAddress);
    await mintAndDepositVaultCollateralToOwner(context, agentB, deposit, ownerAddress);
    await agentB.depositVaultCollateral(deposit);
    await agentB.buyCollateralPoolTokens(deposit);
    await agentB.makeAvailable();
    return agentB;
}

export async function createTestAgentBotAndMakeAvailable(
    context: TestAssetBotContext,
    orm: ORM,
    ownerAddress: string,
    ownerUnderlyingAddress?: string,
    notifier: Notifier = new Notifier(),
    options?: AgentBotDefaultSettings
) {
    const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, notifier, options);
    await mintAndDepositVaultCollateralToOwner(context, agentBot.agent, deposit, ownerAddress);
    await agentBot.agent.depositVaultCollateral(deposit);
    await agentBot.agent.buyCollateralPoolTokens(deposit);
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
    const stablecoinUSD = await priceReader.getRawPrice(collateralToken.tokenFtsoSymbol, true);
    const expPlus = Number(collateralToken.decimals) + Number(stablecoinUSD.decimals);
    return toBN(amount).mul(toBNExp(10, expPlus)).div(stablecoinUSD.price);
}

export async function fromAgentInfoToInitialAgentData(agent: Agent): Promise<InitialAgentData> {
    const agentInfo = await agent.getAgentInfo();
    const initialAgentData = {
        owner: agent.ownerAddress,
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
