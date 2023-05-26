import { FilterQuery } from "@mikro-orm/core";
import { ORM } from "../../src/config/orm";
import { WalletAddress } from "../../src/entities/wallet";
import { Agent } from "../../src/fasset/Agent";
import { BNish } from "../../src/utils/helpers";
import { requiredEventArgs } from "../../src/utils/events/truffle";
import { TransactionOptionsWithFee } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { RedemptionRequested } from "../../typechain-truffle/AssetManager";
import { EventArgs } from "../../src/utils/events/common";


export async function removeWalletAddressFromDB(orm: ORM, address: string) {
    const wa0 = await orm.em.findOne(WalletAddress, { address } as FilterQuery<WalletAddress>);
    if (wa0) await orm.em.removeAndFlush(wa0);
}

export async function performRedemptionPayment(agent: Agent, request: EventArgs<RedemptionRequested>, options?: TransactionOptionsWithFee): Promise<string> {
    const paymentAmount = request.valueUBA.sub(request.feeUBA);
    return await agent.performPayment(request.paymentAddress, paymentAmount, request.paymentReference, options);
}
