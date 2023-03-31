import { TraceManager } from "@flarenetwork/mcc";
import assert from "node:assert";
import { TraceManager as TraceManagerSimpleWallet } from "simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace";
import { AgentBot } from "../../src/actors/AgentBot";
import { AgentBotRunner } from "../../src/actors/AgentBotRunner";
import { Challenger } from "../../src/actors/Challenger";
import { createAgentBotSettings } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { AgentB } from "../../src/fasset-bots/AgentB";
import { AgentBotSettings } from "../../src/fasset-bots/IAssetBotContext";
import { TrackedState } from "../../src/state/TrackedState";
import { artifacts } from "../../src/utils/artifacts";
import { ScopedRunner } from "../../src/utils/events/ScopedRunner";
import { Notifier } from "../../src/utils/Notifier";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { TestAssetBotContext } from "./test-asset-context";

const ERC20Mock = artifacts.require('ERC20Mock');

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

export function createAgentBotRunner(contexts: Map<number, TestAssetBotContext>, orm: ORM, loopDelay: number) {
    return new AgentBotRunner(contexts, orm, loopDelay, new Notifier());
}