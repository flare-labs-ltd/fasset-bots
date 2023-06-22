import { FilterQuery } from "@mikro-orm/core";
import { ORM } from "../../src/config/orm";
import { WalletAddress } from "../../src/entities/wallet";
import { Agent } from "../../src/fasset/Agent";
import { TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EventArgs } from "../../src/utils/events/common";
import { SourceId } from "../../src/verification/sources/sources";
import { BlockChainIndexerHelper } from "../../src/underlying-chain/BlockChainIndexerHelper";
import { createBlockChainIndexerHelper } from "../../src/config/BotConfig";


export async function removeWalletAddressFromDB(orm: ORM, address: string) {
    const wa0 = await orm.em.findOne(WalletAddress, { address } as FilterQuery<WalletAddress>);
    if (wa0) await orm.em.removeAndFlush(wa0);
}

export async function performRedemptionPayment(agent: Agent, request: EventArgs<RedemptionRequested>, options?: TransactionOptionsWithFee): Promise<string> {
    const paymentAmount = request.valueUBA.sub(request.feeUBA);
    return await agent.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
}

export async function receiveBlockAndTransaction(sourceId: SourceId, blockChainIndexerClient: BlockChainIndexerHelper): Promise<{ blockNumber: number, blockHash: string, txHash: string | null } | null> {
    const blockChainHelper = createBlockChainIndexerHelper(sourceId);
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
