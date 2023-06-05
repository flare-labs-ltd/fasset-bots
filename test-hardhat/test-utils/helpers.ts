import { TraceManager } from "@flarenetwork/mcc";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { TraceManager as TraceManagerSimpleWallet } from "simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace";
import { AgentBot } from "../../src/actors/AgentBot";
import { AgentBotRunner } from "../../src/actors/AgentBotRunner";
import { Challenger } from "../../src/actors/Challenger";
import { AgentSettingsConfig, createAgentBotDefaultSettings } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { AgentB } from "../../src/fasset-bots/AgentB";
import { AgentBotDefaultSettings } from "../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../src/fasset/Agent";
import { AgentStatus, CollateralType, CollateralClass } from "../../src/fasset/AssetManagerTypes";
import { IAssetContext } from "../../src/fasset/IAssetContext";
import { TrackedState } from "../../src/state/TrackedState";
import { artifacts } from "../../src/utils/artifacts";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { BNish, requireEnv, requireNotNull, toBN, toBNExp } from "../../src/utils/helpers";
import { Notifier } from "../../src/utils/Notifier";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { IERC20Instance } from "../../typechain-truffle";
import { TestAssetBotContext, TestAssetTrackedStateContext, createTestAssetContext } from "./create-test-asset-context";
import { testChainInfo } from "../../test/test-utils/TestChainInfo";
import fs from "fs";
import { Minter } from "../../src/mock/Minter";
import { MockChain } from "../../src/mock/MockChain";
import { Liquidator } from "../../src/actors/Liquidator";
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { Redeemer } from "../../src/mock/Redeemer";
import { TokenPriceReader } from "../../src/state/TokenPrice";
import BN from "bn.js";
import { InitialAgentData } from "../../src/state/TrackedAgentState";

const ERC20Mock = artifacts.require('ERC20Mock');
const DEFAULT_AGENT_SETTINGS_PATH: string = requireEnv('DEFAULT_AGENT_SETTINGS_PATH');
const agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH).toString()) as AgentSettingsConfig;

const agentUnderlying: string = "UNDERLYING_ADDRESS";
const redeemerUnderlying = "REDEEMER_UNDERLYING_ADDRESS";
const minterUnderlying: string = "MINTER_UNDERLYING_ADDRESS";
const deposit = toBNExp(1_000_000, 18);

export function disableMccTraceManager() {
    TraceManager.enabled = false;
    TraceManagerSimpleWallet.enabled = false;
}

export function assertWeb3DeepEqual(x: any, y: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(x), web3DeepNormalize(y), message);
}

export async function createTestAgentBot(context: TestAssetBotContext, orm: ORM, ownerAddress: string, options?: AgentBotDefaultSettings): Promise<AgentBot> {
    const agentBotSettings: AgentBotDefaultSettings = options ? options : await createAgentBotDefaultSettings(context);
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, new Notifier());
}

export async function mintClass1ToOwner(vaultAddress: string, amount: BNish, class1TokenAddress: string, ownerAddress: string): Promise<void> {
    const class1Token = await ERC20Mock.at(class1TokenAddress);
    await class1Token.mintAmount(ownerAddress, amount);
    await class1Token.approve(vaultAddress, amount, { from: ownerAddress });
}

export async function createTestChallenger(address: string, state: TrackedState, context: TestAssetTrackedStateContext): Promise<Challenger> {
    return new Challenger(new ScopedRunner(), address, state, await context.chain.getBlockHeight());
}

export async function createTestLiquidator(address: string, state: TrackedState): Promise<Liquidator> {
    return new Liquidator(new ScopedRunner(), address, state);
}

export async function createTestSystemKeeper(address: string, state: TrackedState): Promise<SystemKeeper> {
    return new SystemKeeper(new ScopedRunner(), address, state);
}

export async function createTestAgentB(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string = agentUnderlying): Promise<AgentB> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context);
    const agentSettings = { underlyingAddressString: underlyingAddress, ...agentBotSettings };
    return await AgentB.create(context, ownerAddress, agentSettings);
}

export async function createTestAgent(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string = agentUnderlying): Promise<Agent> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context);
    const agentSettings = { underlyingAddressString: underlyingAddress, ...agentBotSettings };
    return await Agent.create(context, ownerAddress, agentSettings);
}

export function createTestAgentBotRunner(contexts: Map<number, TestAssetBotContext>, orm: ORM, loopDelay: number): AgentBotRunner {
    return new AgentBotRunner(contexts, orm, loopDelay, new Notifier());
}

export async function createTestMinter(context: IAssetContext, minterAddress: string, chain: MockChain, amount: BN = deposit): Promise<Minter> {
    const minter = await Minter.createTest(context, minterAddress, minterUnderlying, amount);
    chain.mine(chain.finalizationBlocks + 1);
    return minter;
}

export async function createTestRedeemer(context: IAssetContext, redeemerAddress: string) {
    const redeemer = await Redeemer.create(context, redeemerAddress, redeemerUnderlying);
    return redeemer;
}

export async function createTestAgentAndMakeAvailable(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string): Promise<Agent> {
    const agent = await createTestAgent(context, ownerAddress, underlyingAddress);
    await mintAndDepositClass1ToOwner(context, agent.vaultAddress, deposit, ownerAddress);
    await agent.depositClass1Collateral(deposit);
    await agent.buyCollateralPoolTokens(deposit);
    await agent.makeAvailable();
    return agent;
}

export async function createTestAgentBAndMakeAvailable(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string = agentUnderlying): Promise<AgentB> {
    const agentB = await createTestAgentB(context, ownerAddress, underlyingAddress);
    await mintAndDepositClass1ToOwner(context, agentB.vaultAddress, deposit, ownerAddress);
    await agentB.depositClass1Collateral(deposit);
    await agentB.buyCollateralPoolTokens(deposit);
    await agentB.makeAvailable();
    return agentB;
}

export async function createTestAgentBotAndMakeAvailable(context: TestAssetBotContext, orm: ORM, ownerAddress: string, options?: AgentBotDefaultSettings) {
    const agentBot = await createTestAgentBot(context, orm, ownerAddress, options);
    await mintAndDepositClass1ToOwner(context, agentBot.agent.vaultAddress, deposit, ownerAddress);
    await agentBot.agent.depositClass1Collateral(deposit);
    await agentBot.agent.buyCollateralPoolTokens(deposit);
    await agentBot.agent.makeAvailable();
    return agentBot;
}

export async function mintAndDepositClass1ToOwner(context: IAssetContext, vaultAddress: string, depositAmount: BNish, ownerAddress: string): Promise<IERC20Instance> {
    const class1Token = (await context.assetManager.getCollateralTypes()).find(token => {
        return Number(token.collateralClass) === CollateralClass.CLASS1 && token.tokenFtsoSymbol === agentSettingsConfig.class1FtsoSymbol
    });
    const class1TokenContract = requireNotNull(Object.values(context.stablecoins).find(token => token.address === class1Token?.token));
    await mintClass1ToOwner(vaultAddress, depositAmount, class1Token!.token, ownerAddress);
    return class1TokenContract;
}

export async function createTestContext(governance: string, setMaxTrustedPriceAgeSeconds: number) {
    const parameterFilename = `../fasset/deployment/config/hardhat/f-${testChainInfo.xrp.symbol.toLowerCase()}.json`;
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

export async function convertFromUSD5(amount: BN, collateralToken: CollateralType, context: TestAssetBotContext): Promise<BN> {
    const priceReader = new TokenPriceReader(context.ftsoRegistry);
    const stablecoinUSD = await priceReader.getRawPrice(collateralToken.tokenFtsoSymbol, true);
    const expPlus = Number(collateralToken.decimals) + Number(stablecoinUSD.decimals);
    return (toBN(amount).mul(toBNExp(10, expPlus))).div(stablecoinUSD.price);
}

export async function fromAgentInfoToInitialAgentData(agent: Agent): Promise<InitialAgentData> {
    const agentInfo = await agent.getAgentInfo();
    const initialAgentData = {
        owner: agent.ownerAddress,
        agentVault: agent.vaultAddress,
        collateralPool: agentInfo.collateralPool,
        underlyingAddress: agent.underlyingAddress,
        class1CollateralToken: agentInfo.class1CollateralToken,
        feeBIPS: toBN(agentInfo.feeBIPS),
        poolFeeShareBIPS: toBN(agentInfo.poolFeeShareBIPS),
        mintingClass1CollateralRatioBIPS: toBN(agentInfo.mintingClass1CollateralRatioBIPS),
        mintingPoolCollateralRatioBIPS: toBN(agentInfo.mintingPoolCollateralRatioBIPS),
        buyFAssetByAgentFactorBIPS: toBN(agentInfo.buyFAssetByAgentFactorBIPS),
        poolExitCollateralRatioBIPS: toBN(agentInfo.poolExitCollateralRatioBIPS),
        poolTopupCollateralRatioBIPS: toBN(agentInfo.poolTopupCollateralRatioBIPS),
        poolTopupTokenPriceFactorBIPS: toBN(agentInfo.poolTopupTokenPriceFactorBIPS)
    };
    return initialAgentData;
}