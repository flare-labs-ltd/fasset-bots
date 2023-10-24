import { FilterQuery } from "@mikro-orm/core";
import { AgentBot } from "../../src/actors/AgentBot";
import { createBlockchainIndexerHelper } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { AgentEntity } from "../../src/entities/agent";
import { WalletAddress } from "../../src/entities/wallet";
import { IAssetAgentBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../src/fasset/Agent";
import { BlockchainIndexerHelper } from "../../src/underlying-chain/BlockchainIndexerHelper";
import { TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { Notifier } from "../../src/utils/Notifier";
import { EventArgs } from "../../src/utils/events/common";
import { requiredEventArgs } from "../../src/utils/events/truffle";
import { BN_ZERO, requireConfigVariable, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { artifacts } from "../../src/utils/web3";
import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { SourceId } from "../../src/underlying-chain/SourceId";

const FakeERC20 = artifacts.require("FakeERC20");

const ownerAccountPrivateKey = requireConfigVariable("owner.native_private_key");
const account1PrivateKey = requireConfigVariable("challenger.native_private_key");
const userPrivateKey = requireConfigVariable("user.native_private_key");
const account3PrivateKey = requireConfigVariable("timeKeeper.native_private_key");
const account4PrivateKey = requireConfigVariable("systemKeeper.native_private_key");

export const depositVaultCollateralAmount = toBNExp(1_000_000, 18);
export function getNativeAccountsFromEnv() {
    // owner is always first in array
    // deployer account / current coston governance in always last in array
    return [ownerAccountPrivateKey, account1PrivateKey, userPrivateKey, account3PrivateKey, account4PrivateKey];
}

export async function removeWalletAddressFromDB(orm: ORM, address: string) {
    const wa0 = await orm.em.findOne(WalletAddress, { address } as FilterQuery<WalletAddress>);
    if (wa0) await orm.em.removeAndFlush(wa0);
}

export async function performRedemptionPayment(agent: Agent, request: EventArgs<RedemptionRequested>, options?: TransactionOptionsWithFee): Promise<string> {
    const paymentAmount = request.valueUBA.sub(request.feeUBA);
    return await agent.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
}

export async function receiveBlockAndTransaction(
    sourceId: SourceId,
    blockChainIndexerClient: BlockchainIndexerHelper,
    indexerUrl: string,
    finalizationBlocks: number
): Promise<{ blockNumber: number; blockHash: string; txHash: string | null } | null> {
    const blockChainHelper = createBlockchainIndexerHelper(sourceId, indexerUrl, finalizationBlocks);
    const resp = (await blockChainIndexerClient.client.get(`/api/indexer/block-range`)).data;
    if (resp.status === "OK") {
        const blockNumber = resp.data.last;
        const block = await blockChainHelper.getBlockAt(blockNumber);
        const blockHash = block!.hash;
        let txHash = null;
        if (block!.transactions.length > 0) {
            txHash = block!.transactions[0];
        }
        return {
            blockNumber,
            blockHash,
            txHash,
        };
    }
    return null;
}

export async function balanceOfVaultCollateral(vaultCollateralTokenAddress: string, address: string): Promise<BN> {
    const vaultCollateralToken = await FakeERC20.at(vaultCollateralTokenAddress);
    return await vaultCollateralToken.balanceOf(address);
}

export async function cleanUp(context: IAssetAgentBotContext, orm: ORM, ownerAddress: string, destroyAgentsAfterTests: string[]) {
    const destroyAgents = destroyAgentsAfterTests;
    const waitingTime = (await context.assetManager.getSettings()).withdrawalWaitMinSeconds;
    for (const agentAddress of destroyAgents) {
        try {
            await destroyAgent(context, orm, agentAddress, ownerAddress);
        } catch (e) {
            if (e instanceof Error) {
                if (e.message.includes("destroy: not allowed yet")) {
                    await sleep(Number(toBN(waitingTime).muln(1000)));
                    await destroyAgent(context, orm, agentAddress, ownerAddress);
                }
                if (e.message.includes("destroy not announced")) {
                    await context.assetManager.announceDestroyAgent(agentAddress, { from: ownerAddress });
                    await sleep(Number(toBN(waitingTime).muln(1000)));
                    await destroyAgent(context, orm, agentAddress, ownerAddress);
                }
                if (e.message.includes("AgentEntity not found")) {
                    continue;
                }
                console.log(e.message, agentAddress);
            }
        }
    }
}

export async function destroyAgent(context: IAssetAgentBotContext, orm: ORM, agentAddress: string, ownerAddress: string) {
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentAddress, active: true } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentEnt, new Notifier());
    const agentInfoForAnnounce = await context.assetManager.getAgentInfo(agentAddress);
    const freeVaultCollateralBalance = toBN(agentInfoForAnnounce.freeVaultCollateralWei);
    const freePoolTokenBalance = toBN(agentInfoForAnnounce.freePoolCollateralNATWei);
    const waitingTime = (await context.assetManager.getSettings()).withdrawalWaitMinSeconds;
    if (freeVaultCollateralBalance.gt(BN_ZERO)) {
        // announce withdraw class 1
        await agentBot.agent.announceVaultCollateralWithdrawal(freeVaultCollateralBalance);
        await sleep(Number(toBN(waitingTime).muln(1000)));
        await agentBot.agent.withdrawVaultCollateral(freeVaultCollateralBalance.toString());
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
    const eventArgs = requiredEventArgs(res, "AgentDestroyed");
    if (eventArgs) {
        console.log("Agent is destroyed", agentAddress);
        agentEnt.active = false;
        await orm.em.persistAndFlush(agentEnt);
    }
}

export async function findAgentBotFromDB(agentVaultAddress: string, context: IAssetAgentBotContext, orm: ORM): Promise<AgentBot> {
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentVaultAddress, active: true } as FilterQuery<AgentEntity>);
    return await AgentBot.fromEntity(context, agentEnt, new Notifier());
}
