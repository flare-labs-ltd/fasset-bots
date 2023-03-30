import { TraceManager } from "@flarenetwork/mcc";
import assert from "node:assert";
import { TraceManager as TraceManagerSimpleWallet } from "simple-wallet/node_modules/@flarenetwork/mcc/dist/src/utils/trace";
import { AgentBot } from "../../src/actors/AgentBot";
import { ORM } from "../../src/config/orm";
import { AgentBotSettings } from "../../src/fasset-bots/IAssetBotContext";
import { artifacts } from "../../src/utils/artifacts";
import { Notifier } from "../../src/utils/Notifier";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { createTestAgentBotSettings, TestAssetBotContext } from "./test-asset-context";

const ERC20Mock = artifacts.require('ERC20Mock');

export function disableMccTraceManager() {
    TraceManager.enabled = false;
    TraceManagerSimpleWallet.enabled = false;
}

export function assertWeb3DeepEqual(x: any, y: any, message?: string) {
    assert.deepStrictEqual(web3DeepNormalize(x), web3DeepNormalize(y), message);
}

export async function createAgentBot(context: TestAssetBotContext, orm: ORM, ownerAddress: string): Promise<AgentBot> {
    const agentBotSettings: AgentBotSettings = await createTestAgentBotSettings(context);
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, new Notifier());
}

export async function mintClass1ToOwner(agentBot: AgentBot, amount: BN, class1TokenAddress: string, ownerAddress: string): Promise<void> {
    const class1Token = await ERC20Mock.at(class1TokenAddress);
    await class1Token.mintAmount(ownerAddress, amount);
    await class1Token.approve(agentBot.agent.vaultAddress, amount, { from: ownerAddress });
}