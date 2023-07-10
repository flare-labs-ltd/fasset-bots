import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { Minter } from "../../src/mock/Minter";
import { BN_ZERO, BNish, fail, requireEnv, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { SourceId } from "../../src/verification/sources/sources";
import axios from "axios";
import { Redeemer } from "../../src/mock/Redeemer";
import { ORM } from "../../src/config/orm";
import { AgentBot } from "../../src/actors/AgentBot";
import { createAgentBotDefaultSettings } from "../../src/config/BotConfig";
import { Notifier } from "../../src/utils/Notifier";
import { artifacts } from "../../src/utils/artifacts";
import { AgentEntity } from "../../src/entities/agent";
import { FilterQuery } from "@mikro-orm/core";
import { requiredEventArgs } from "../../src/utils/events/truffle";

const ownerAccountPrivateKey = requireEnv('OWNER_PRIVATE_KEY');
const account1PrivateKey = requireEnv('NATIVE_ACCOUNT1_PRIVATE_KEY');
const account2PrivateKey = requireEnv('NATIVE_ACCOUNT2_PRIVATE_KEY');
const account3PrivateKey = requireEnv('NATIVE_ACCOUNT3_PRIVATE_KEY');
const deployPrivateKey = requireEnv('DEPLOY_PRIVATE_KEY');
export const depositClass1Amount = toBNExp(1_000_000, 18);

const ERC20Mock = artifacts.require('ERC20Mock');

export async function createTestMinter(ctx: IAssetAgentBotContext, address: string) {
    if (!(ctx.chainInfo.chainId === SourceId.XRP)) fail("only for XRP testnet for now");
    const resp = await axios.post("https://faucet.altnet.rippletest.net/accounts");
    if (resp.statusText === 'OK') {
        const account = resp.data.account;
        await ctx.wallet.addExistingAccount(account.address, account.secret);
        return Minter.create(ctx, address, account.address, ctx.wallet);
    }
    throw new Error("Cannot get underlying address from testnet");
}

export async function createTestRedeemer(ctx: IAssetAgentBotContext, address: string) {
    const underlyingAddress = await ctx.wallet.createAccount();
    return new Redeemer(ctx, address, underlyingAddress);
}

export function getNativeAccountsFromEnv() {
    return [ownerAccountPrivateKey, account1PrivateKey, account2PrivateKey, account3PrivateKey, deployPrivateKey];
}

export async function createTestAgentBot(context: IAssetAgentBotContext, orm: ORM, ownerAddress: string, notifier: Notifier = new Notifier()): Promise<AgentBot> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context);
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, notifier);
}

export async function mintClass1ToOwner(class1TokenAddress: string, ownerAddress: string, amount: BNish = depositClass1Amount): Promise<void> {
    console.log(class1TokenAddress);
    const class1Token = await ERC20Mock.at(class1TokenAddress);
    await class1Token.mintAmount(ownerAddress, amount, { from: ownerAddress});
}

export async function balanceOfClass1(class1TokenAddress: string, address: string): Promise<BN> {
    const class1Token = await ERC20Mock.at(class1TokenAddress);
    return await class1Token.balanceOf(address);
}

export async function cleanUp(context: IAssetAgentBotContext, orm: ORM, ownerAddress: string) {
    const list = await context.assetManager.getAllAgents(0, 100);
    const waitingTime = (await context.assetManager.getSettings()).withdrawalWaitMinSeconds;
    for (const agentAddress of list[0]) {
        try {
            await destroyAgent(context, orm, agentAddress, ownerAddress);
        } catch (e) {
            if (e instanceof Error) {
                if (e.message.includes('destroy: not allowed yet')) {
                    await sleep(Number(toBN(waitingTime).muln(1000)));
                    await destroyAgent(context, orm, agentAddress, ownerAddress);
                }
                if (e.message.includes('destroy not announced')) {
                    await context.assetManager.announceDestroyAgent(agentAddress, { from: ownerAddress });
                    await sleep(Number(toBN(waitingTime).muln(1000)));
                    await destroyAgent(context, orm, agentAddress, ownerAddress);
                }
                if(e.message.includes('AgentEntity not found')) { continue; }
                console.log(e.message, agentAddress);
            }
        }
    }
}

export async function destroyAgent(context: IAssetAgentBotContext, orm: ORM, agentAddress: string, ownerAddress: string) {
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentAddress, active: true } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt, new Notifier());
    const agentInfoForAnnounce = await context.assetManager.getAgentInfo(agentAddress);
    const freeClass1Balance = toBN(agentInfoForAnnounce.freeClass1CollateralWei);
    const freePoolTokenBalance = toBN(agentInfoForAnnounce.freePoolCollateralNATWei);
    const wNAtBalance = await context.wNat.balanceOf(ownerAddress);
    console.log(wNAtBalance.toString())
    const waitingTime = (await context.assetManager.getSettings()).withdrawalWaitMinSeconds;
    if (freeClass1Balance.gt(BN_ZERO)) {
        // announce withdraw class 1
        await agentBot.agent.announceClass1CollateralWithdrawal(freeClass1Balance);
        await sleep(Number(toBN(waitingTime).muln(1000)));
        await agentBot.agent.withdrawClass1Collateral(freeClass1Balance.toString());
    }
    if (freePoolTokenBalance.gt(BN_ZERO)) {
        // announce redeem pool tokens and wait for others to do so (pool needs to be empty)
        await agentBot.agent.announcePoolTokenRedemption(freePoolTokenBalance);
        await sleep(Number(toBN(waitingTime).muln(1000)));
        await agentBot.agent.redeemCollateralPoolTokens(freePoolTokenBalance.toString());
    }

    await context.assetManager.announceDestroyAgent(agentAddress, { from: ownerAddress });
    await sleep(Number(toBN(waitingTime).muln(1000)));

    const res = await context.assetManager.destroyAgent(agentAddress, ownerAddress, { from: ownerAddress });
    const eventArgs = requiredEventArgs(res, 'AgentDestroyed');
    if (eventArgs) {
        console.log("Agent is destroyed", agentAddress);
        agentEnt.active = false;
        await orm.em.persistAndFlush(agentEnt);
    }
}

