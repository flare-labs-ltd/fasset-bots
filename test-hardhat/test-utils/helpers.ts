import { TraceManager } from "@flarenetwork/mcc";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { TraceManager as TraceManagerSimpleWallet } from "simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace";
import { AgentBot } from "../../src/actors/AgentBot";
import { AgentBotRunner } from "../../src/actors/AgentBotRunner";
import { Challenger } from "../../src/actors/Challenger";
import { AgentSettingsConfig, createAgentBotSettings } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { AgentB } from "../../src/fasset-bots/AgentB";
import { AgentBotSettings } from "../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../src/fasset/Agent";
import { CollateralTokenClass } from "../../src/fasset/AssetManagerTypes";
import { IAssetContext } from "../../src/fasset/IAssetContext";
import { TrackedState } from "../../src/state/TrackedState";
import { artifacts } from "../../src/utils/artifacts";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { requireEnv, requireNotNull, toBN } from "../../src/utils/helpers";
import { Notifier } from "../../src/utils/Notifier";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { IERC20Instance } from "../../typechain-truffle";
import { TestAssetBotContext, createTestAssetContext } from "./test-asset-context";
import { TestChainInfo, testChainInfo } from "../../test/test-utils/TestChainInfo";
import fs from "fs";

const ERC20Mock = artifacts.require('ERC20Mock');
const DEFAULT_AGENT_SETTINGS_PATH: string = requireEnv('DEFAULT_AGENT_SETTINGS_PATH');
const agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH).toString()) as AgentSettingsConfig;

export function disableMccTraceManager() {
    TraceManager.enabled = false;
    TraceManagerSimpleWallet.enabled = false;
}

export function assertWeb3DeepEqual(x: any, y: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(x), web3DeepNormalize(y), message);
}

export async function createAgentBot(context: TestAssetBotContext, orm: ORM, ownerAddress: string): Promise<AgentBot> {
    const agentBotSettings: AgentBotSettings = await createAgentBotSettings(context);
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, new Notifier());
}

export async function mintClass1ToOwner(vaultAddress: string, amount: BN, class1TokenAddress: string, ownerAddress: string): Promise<void> {
    const class1Token = await ERC20Mock.at(class1TokenAddress);
    await class1Token.mintAmount(ownerAddress, amount);
    await class1Token.approve(vaultAddress, amount, { from: ownerAddress });
}

export async function createTestChallenger(address: string, state: TrackedState, context: TestAssetBotContext): Promise<Challenger> {
    return new Challenger(new ScopedRunner(), address, state, await context.chain.getBlockHeight());
}

export async function createAgentB(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string): Promise<AgentB> {
    const agentBotSettings: AgentBotSettings = await createAgentBotSettings(context);
    const agentSettings = { underlyingAddressString: underlyingAddress, ...agentBotSettings };
    return await AgentB.create(context, ownerAddress, agentSettings);
}

export async function createAgent(context: TestAssetBotContext, ownerAddress: string, underlyingAddress: string): Promise<Agent> {
    const agentBotSettings: AgentBotSettings = await createAgentBotSettings(context);
    const agentSettings = { underlyingAddressString: underlyingAddress, ...agentBotSettings };
    return await Agent.create(context, ownerAddress, agentSettings);
}

export function createAgentBotRunner(contexts: Map<number, TestAssetBotContext>, orm: ORM, loopDelay: number) {
    return new AgentBotRunner(contexts, orm, loopDelay, new Notifier());
}

export async function mintAndDepositClass1ToOwner(context: IAssetContext, vaultAddress: string, depositAmount: BN, ownerAddress: string): Promise<IERC20Instance> {
    const class1Token = (await context.assetManager.getCollateralTokens()).find(token => {
        return Number(token.tokenClass) === CollateralTokenClass.CLASS1 && token.ftsoSymbol === agentSettingsConfig.class1FtsoSymbol
    });
    const class1TokenContract = requireNotNull(Object.values(context.stablecoins).find(token => token.address === class1Token?.token));
    await mintClass1ToOwner(vaultAddress, depositAmount, class1Token!.token, ownerAddress);
    return class1TokenContract;
}

export async function createTestContext(governance: string, setMaxTrustedPriceAgeSeconds: number) {
    const parameterFilename = `../fasset/deployment/config/hardhat/f-${testChainInfo.xrp.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    parameters.maxTrustedPriceAgeSeconds = setMaxTrustedPriceAgeSeconds;
    return  await createTestAssetContext(governance, testChainInfo.xrp, undefined, parameters);
}