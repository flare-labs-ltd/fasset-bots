import { EntityManager, FilterQuery } from "@mikro-orm/core";
import BN from "bn.js";
import { AgentBot } from "../../src/actors/AgentBot";
import { AgentBotSettings, createBlockchainIndexerHelper } from "../../src/config/BotConfig";
import { ORM } from "../../src/config/orm";
import { Secrets } from "../../src/config/secrets";
import { AgentEntity } from "../../src/entities/agent";
import { IAssetAgentContext } from "../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../src/fasset/Agent";
import { MockChain } from "../../src/mock/MockChain";
import { BlockchainIndexerHelper } from "../../src/underlying-chain/BlockchainIndexerHelper";
import { BlockchainWalletHelper } from "../../src/underlying-chain/BlockchainWalletHelper";
import { ChainId } from "../../src/underlying-chain/ChainId";
import { DBWalletKeys } from "../../src/underlying-chain/WalletKeys";
import { TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { TokenBalances } from "../../src/utils";
import { EventArgs } from "../../src/utils/events/common";
import { requiredEventArgs } from "../../src/utils/events/truffle";
import { BN_ZERO, fail, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { artifacts } from "../../src/utils/web3";
import { TestAssetBotContext } from "../../test-hardhat/test-utils/create-test-asset-context";
import { RedemptionRequested } from "../../typechain-truffle/IIAssetManager";
import { testNotifierTransports } from "./testNotifierTransports";
import { IWalletKeys } from "../../../simple-wallet/src/interfaces/WalletTransactionInterface";
import { WalletAddressEntity } from "../../../simple-wallet/src/entity/wallet";

const FakeERC20 = artifacts.require("FakeERC20");

export const depositVaultCollateralAmount = toBNExp(1_000_000, 6);

export function getNativeAccounts(secrets: Secrets) {
    const ownerAccountPrivateKey = secrets.required("owner.native.private_key");
    const account1PrivateKey = secrets.required("challenger.private_key");
    const userPrivateKey = secrets.required("user.native.private_key");
    const timeKeeperPrivateKey = secrets.required("timeKeeper.private_key");
    const systemKeeperPrivateKey = secrets.required("systemKeeper.private_key");
    // owner is always first in array
    // deployer account / current coston governance in always last in array
    return [ownerAccountPrivateKey, account1PrivateKey, userPrivateKey, timeKeeperPrivateKey, systemKeeperPrivateKey];
}

export async function removeWalletAddressFromDB(walletKeys: IWalletKeys | BlockchainWalletHelper, address: string) {
    if (walletKeys instanceof BlockchainWalletHelper) {
        walletKeys = (walletKeys as any).walletKeys;
    }
    if (!(walletKeys instanceof DBWalletKeys)) {
        throw new Error("Expected DBWalletKeys");
    }
    const em = (walletKeys as any).em as EntityManager;
    const wa0 = await em.findOne(WalletAddressEntity, { address } as FilterQuery<WalletAddressEntity>);
    if (wa0) await em.removeAndFlush(wa0);
    const cache = (walletKeys as any).privateKeyCache as Map<string, string>;
    cache.delete(address);
}

export async function performRedemptionPayment(agent: Agent, request: EventArgs<RedemptionRequested>, options?: TransactionOptionsWithFee): Promise<string> {
    const paymentAmount = request.valueUBA.sub(request.feeUBA);
    return await agent.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, agent.underlyingAddress, options);
}

export async function receiveBlockAndTransaction(
    chainId: ChainId,
    blockChainIndexerClient: BlockchainIndexerHelper,
    indexerUrl: string,
    indexerApiKey: string,
): Promise<{ blockNumber: number; blockHash: string; txHash: string | null } | null> {
    const blockChainHelper = createBlockchainIndexerHelper(chainId, indexerUrl, indexerApiKey);
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

export async function cleanUp(context: IAssetAgentContext, agentBotSettings: AgentBotSettings, orm: ORM, ownerAddress: string, ownerUnderlyingAddress: string, destroyAgentsAfterTests: string[]) {
    const destroyAgents = destroyAgentsAfterTests;
    const waitingTime = (await context.assetManager.getSettings()).withdrawalWaitMinSeconds;
    for (const agentAddress of destroyAgents) {
        try {
            await destroyAgent(context, agentBotSettings, orm, agentAddress, ownerAddress, ownerUnderlyingAddress);
        } catch (e) {
            if (e instanceof Error) {
                if (e.message.includes("destroy: not allowed yet")) {
                    await sleep(Number(toBN(waitingTime).muln(1000)));
                    await destroyAgent(context, agentBotSettings, orm, agentAddress, ownerAddress, ownerUnderlyingAddress);
                }
                if (e.message.includes("destroy not announced")) {
                    await context.assetManager.announceDestroyAgent(agentAddress, { from: ownerAddress });
                    await sleep(Number(toBN(waitingTime).muln(1000)));
                    await destroyAgent(context, agentBotSettings, orm, agentAddress, ownerAddress, ownerUnderlyingAddress);
                }
                if (e.message.includes("AgentEntity not found")) {
                    continue;
                }
                console.log(e.message, agentAddress);
            }
        }
    }
}

export async function destroyAgent(context: IAssetAgentContext, agentBotSettings: AgentBotSettings, orm: ORM, agentAddress: string, ownerAddress: string, ownerUnderlyingAddress: string) {
    const agentEnt = await orm.em.findOneOrFail(AgentEntity, { vaultAddress: agentAddress, active: true } as FilterQuery<AgentEntity>);
    const agentBot = await AgentBot.fromEntity(context, agentBotSettings, agentEnt, ownerUnderlyingAddress, testNotifierTransports);
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

export function itIf(condition: boolean | (() => boolean)) {
    if (typeof condition === 'function') condition = condition();
    return condition ? it : it.skip;
}

export function itUnless(condition: boolean | (() => boolean)) {
    if (typeof condition === 'function') condition = condition();
    return condition ? it.skip : it;
}

export function enableSlowTests() {
    return process.env.ENABLE_SLOW_TESTS === 'true';
}

export async function fundUnderlying(context: TestAssetBotContext, underlyingAddress:string, amount: BN) {
    if (!(context.blockchainIndexer.chain instanceof MockChain)) fail("only for mock chains");
    const balanceReader = await TokenBalances.fassetUnderlyingToken(context);
    const senderBalance = await balanceReader.balance(underlyingAddress);
    const minBalance = context.chainInfo.minimumAccountBalance;
    if (senderBalance.eq(BN_ZERO)) {
        context.blockchainIndexer.chain.mint(underlyingAddress, amount.add(minBalance))
    } else {
        context.blockchainIndexer.chain.mint(underlyingAddress, amount)
    }
}
