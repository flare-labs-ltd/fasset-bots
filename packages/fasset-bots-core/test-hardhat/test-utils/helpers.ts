import BN from "bn.js";
import { assert } from "chai";
import fs from "fs";
import { AgentBot } from "../../src/actors/AgentBot";
import { AgentBotRunner, ITimeKeeperService } from "../../src/actors/AgentBotRunner";
import { Challenger } from "../../src/actors/Challenger";
import { Liquidator } from "../../src/actors/Liquidator";
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { BotFAssetConfig, Secrets } from "../../src/config";
import { AgentVaultInitSettings, createAgentVaultInitSettings, loadAgentSettings } from "../../src/config/AgentVaultInitSettings";
import { AssetContractRetriever } from "../../src/config/AssetContractRetriever";
import { ORM } from "../../src/config/orm";
import { IAssetAgentContext, IChallengerContext, ILiquidatorContext } from "../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../src/fasset/Agent";
import { AgentStatus, AssetManagerSettings, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { TokenPriceReader } from "../../src/state/TokenPrice";
import { InitialAgentData } from "../../src/state/TrackedAgentState";
import { TrackedState } from "../../src/state/TrackedState";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { BNish, ZERO_ADDRESS, toBN, toBNExp } from "../../src/utils/helpers";
import { NotifierTransport } from "../../src/utils/notifier/BaseNotifier";
import { artifacts } from "../../src/utils/web3";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import { testNotifierTransports } from "../../test/test-utils/testNotifierTransports";
import { IERC20Instance } from "../../typechain-truffle";
import { TestAssetBotContext, createTestAssetContext } from "./create-test-asset-context";
import { ChainId } from "../../src/underlying-chain/SourceId";

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
    autoSetWorkAddress: boolean = true,
    notifiers: NotifierTransport[] = testNotifierTransports,
    options?: AgentVaultInitSettings,
): Promise<AgentBot> {
    await automaticallySetWorkAddress(context, autoSetWorkAddress, ownerManagementAddress);
    const owner = await Agent.getOwnerAddressPair(context, ownerManagementAddress);
    ownerUnderlyingAddress ??= `underlying_${ownerManagementAddress}`;
    context.blockchainIndexer.chain.mint(ownerUnderlyingAddress, depositUnderlying);
    const vaultUnderlyingAddress = await AgentBot.createUnderlyingAddress(orm.em, context);
    const addressValidityProof = await AgentBot.initializeUnderlyingAddress(context, owner, ownerUnderlyingAddress, vaultUnderlyingAddress);
    const agentBotSettings = options ?? await createAgentVaultInitSettings(context, loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT));
    agentBotSettings.poolTokenSuffix = DEFAULT_POOL_TOKEN_SUFFIX();
    const agentBot = await AgentBot.create(orm.em, context, owner, ownerUnderlyingAddress, addressValidityProof, agentBotSettings, notifiers);
    agentBot.timekeeper = { latestProof: undefined };
    return agentBot;
}

export async function updateAgentBotUnderlyingBlockProof(context: TestAssetBotContext, agentBot: AgentBot, queryWindow: number = 86400) {
    assert(agentBot.timekeeper != null && agentBot.timekeeper.constructor === Object);  // only works for fake timekeeper set by createTestAgentBot
    agentBot.timekeeper.latestProof = await context.attestationProvider.proveConfirmedBlockHeightExists(queryWindow);
}

export async function createTestContractRetriever(context: TestAssetBotContext) {
    return await AssetContractRetriever.create(false, undefined, context.assetManagerController.address);
}

export function makeBotFAssetConfigMap<T extends BotFAssetConfig>(fassets: T[]) {
    return new Map(fassets.map(it => [it.fAssetSymbol, it]));
}

export async function mintVaultCollateralToOwner(amount: BNish, vaultCollateralTokenAddress: string, ownerAddress: string): Promise<void> {
    const vaultCollateralToken = await FakeERC20.at(vaultCollateralTokenAddress);
    await vaultCollateralToken.mintAmount(ownerAddress, amount);
}

export async function createTestChallenger(context: IChallengerContext, address: string, state: TrackedState): Promise<Challenger> {
    return new Challenger(context, new ScopedRunner(), address, state, await context.blockchainIndexer.getBlockHeight(), testNotifierTransports);
}

export async function createTestLiquidator(context: ILiquidatorContext, address: string, state: TrackedState): Promise<Liquidator> {
    return new Liquidator(context, new ScopedRunner(), address, state, testNotifierTransports);
}

export async function createTestSystemKeeper(address: string, state: TrackedState): Promise<SystemKeeper> {
    return new SystemKeeper(new ScopedRunner(), address, state);
}

export async function createTestAgent(
    context: TestAssetBotContext,
    ownerManagementAddress: string,
    underlyingAddress: string = agentUnderlyingAddress,
    autoSetWorkAddress: boolean = true,
): Promise<Agent> {
    await automaticallySetWorkAddress(context, autoSetWorkAddress, ownerManagementAddress);
    const owner = await Agent.getOwnerAddressPair(context, ownerManagementAddress);
    const agentBotSettings: AgentVaultInitSettings = await createAgentVaultInitSettings(context, loadAgentSettings(DEFAULT_AGENT_SETTINGS_PATH_HARDHAT));
    agentBotSettings.poolTokenSuffix = DEFAULT_POOL_TOKEN_SUFFIX();
    const addressValidityProof = await context.attestationProvider.proveAddressValidity(underlyingAddress);
    return await Agent.create(context, owner, addressValidityProof, agentBotSettings);
}

async function automaticallySetWorkAddress(context: TestAssetBotContext, autoSetWorkAddress: boolean, ownerManagementAddress: string) {
    if (autoSetWorkAddress) {
        const workAddress = await context.agentOwnerRegistry.getWorkAddress(ownerManagementAddress);
        if (workAddress === ZERO_ADDRESS) {
            await context.agentOwnerRegistry.setWorkAddress(ownerManagementAddress, { from: ownerManagementAddress });
        }
    }
}

export const testTimekeeperService: ITimeKeeperService = {
    get(chainId: ChainId) {
        return { latestProof: undefined };
    },
};

export function createTestAgentBotRunner(
    secrets: Secrets,
    contexts: Map<ChainId, TestAssetBotContext>,
    orm: ORM,
    loopDelay: number,
    notifiers: NotifierTransport[] = testNotifierTransports,
): AgentBotRunner {
    return new AgentBotRunner(secrets, contexts, orm, loopDelay, notifiers, testTimekeeperService);
}

export async function createTestMinter(context: IAssetAgentContext, minterAddress: string, chain: MockChain, underlyingAddress: string = minterUnderlyingAddress, amount: BN = depositUnderlying): Promise<Minter> {
    const minter = await Minter.createTest(context, minterAddress, underlyingAddress, amount);
    chain.mine(chain.finalizationBlocks + 1);
    return minter;
}

export async function createTestRedeemer(context: IAssetAgentContext, redeemerAddress: string, underlyingAddress: string = redeemerUnderlyingAddress) {
    const redeemer = await Redeemer.create(context, redeemerAddress, underlyingAddress);
    return redeemer;
}

export async function createTestAgentAndMakeAvailable(
    context: TestAssetBotContext,
    ownerAddress: string,
    underlyingAddress: string = agentUnderlyingAddress,
    autoSetWorkAddress: boolean = true,
): Promise<Agent> {
    const agent = await createTestAgent(context, ownerAddress, underlyingAddress, autoSetWorkAddress);
    await mintAndDepositVaultCollateralToOwner(context, agent, depositUSDC, ownerAddress);
    await agent.depositVaultCollateral(depositUSDC);
    await agent.buyCollateralPoolTokens(depositNat);
    await agent.makeAvailable();
    return agent;
}

export async function createTestAgentBotAndMakeAvailable(
    context: TestAssetBotContext,
    orm: ORM,
    ownerAddress: string,
    ownerUnderlyingAddress?: string,
    autoSetWorkAddress: boolean = true,
    notifier: NotifierTransport[] = [],
    options?: AgentVaultInitSettings,
) {
    const agentBot = await createTestAgentBot(context, orm, ownerAddress, ownerUnderlyingAddress, autoSetWorkAddress, notifier, options);
    await mintAndDepositVaultCollateralToOwner(context, agentBot.agent, depositUSDC, agentBot.agent.owner.workAddress);
    await agentBot.agent.depositVaultCollateral(depositUSDC);
    await agentBot.agent.buyCollateralPoolTokens(depositNat);
    await agentBot.agent.makeAvailable();
    return agentBot;
}

export async function mintAndDepositVaultCollateralToOwner( //TODO
    context: IAssetAgentContext,
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

export async function convertFromUSD5(amount: BNish, collateralToken: CollateralType, settings: AssetManagerSettings): Promise<BN> {
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
