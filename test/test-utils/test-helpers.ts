import { FilterQuery } from "@mikro-orm/core";
import { ORM } from "../../src/config/orm";
import { WalletAddress } from "../../src/entities/wallet";
import { Agent } from "../../src/fasset/Agent";
import { TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EventArgs } from "../../src/utils/events/common";
import { SourceId } from "../../src/verification/sources/sources";
import { BlockchainIndexerHelper } from "../../src/underlying-chain/BlockchainIndexerHelper";
import { createBlockchainIndexerHelper } from "../../src/config/BotConfig";
import { requiredEventArgs } from "../../src/utils/events/truffle";
import { artifacts } from "../../src/utils/artifacts";
import { BN_ZERO, BNish, requireEnv, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { AgentBot } from "../../src/actors/AgentBot";
import { IAssetAgentBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { AgentEntity } from "../../src/entities/agent";
import { Notifier } from "../../src/utils/Notifier";

const ERC20Mock = artifacts.require('ERC20Mock');
const Whitelist = artifacts.require('Whitelist');

const ownerAccountPrivateKey = requireEnv('OWNER_PRIVATE_KEY');
const account1PrivateKey = requireEnv('NATIVE_ACCOUNT1_PRIVATE_KEY');
const account2PrivateKey = requireEnv('NATIVE_ACCOUNT2_PRIVATE_KEY');
const account3PrivateKey = requireEnv('NATIVE_ACCOUNT3_PRIVATE_KEY');
const deployPrivateKey = requireEnv('DEPLOY_PRIVATE_KEY');
export const depositClass1Amount = toBNExp(1_000_000, 18);
export function getNativeAccountsFromEnv() {
    // owner is always first in array
    // deployer account / current coston governance in always last in array
    return [ownerAccountPrivateKey, account1PrivateKey, account2PrivateKey, account3PrivateKey, deployPrivateKey];
}

export async function removeWalletAddressFromDB(orm: ORM, address: string) {
    const wa0 = await orm.em.findOne(WalletAddress, { address } as FilterQuery<WalletAddress>);
    if (wa0) await orm.em.removeAndFlush(wa0);
}

export async function performRedemptionPayment(agent: Agent, request: EventArgs<RedemptionRequested>, options?: TransactionOptionsWithFee): Promise<string> {
    const paymentAmount = request.valueUBA.sub(request.feeUBA);
    return await agent.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
}

export async function receiveBlockAndTransaction(sourceId: SourceId, blockChainIndexerClient: BlockchainIndexerHelper): Promise<{ blockNumber: number, blockHash: string, txHash: string | null } | null> {
    const blockChainHelper = createBlockchainIndexerHelper(sourceId);
    const resp = (await blockChainIndexerClient.client.get(`/api/indexer/block-range`)).data;
    if (resp.status === 'OK') {
        const blockNumber = resp.data.last;
        const block = await blockChainHelper.getBlockAt(blockNumber);
        const blockHash = block!.hash;
        let txHash = null;
        if (block!.transactions.length > 0) {
            txHash = block!.transactions[0]
        }
        return {
            blockNumber,
            blockHash,
            txHash
        }
    }
    return null;
}

export async function mintClass1ToOwner(class1TokenAddress: string, ownerAddress: string, amount: BNish = depositClass1Amount): Promise<void> {
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

export async function whitelistAgent(accounts: string[], ownerAddress: string, whitelistAddress: string) {
    const deployerAddress = accounts[accounts.length - 1];
    const agentWhitelist = await Whitelist.at(whitelistAddress);
    await agentWhitelist.addAddressesToWhitelist([ownerAddress], { from: deployerAddress });
}

export async function  findAgentBotFromDB(agentVaultAddress: string, context: IAssetAgentBotContext, orm: ORM): Promise<AgentBot> {
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVaultAddress, active: true } as FilterQuery<AgentEntity>);
    return await AgentBot.fromEntity(context, agentEnt, new Notifier());
}