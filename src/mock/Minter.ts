import { Payment } from "@flarenetwork/state-connector-protocol";
import { CollateralReserved } from "../../typechain-truffle/AssetManager";
import { IAssetAgentBotContext } from "../fasset-bots/IAssetBotContext";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { EventArgs } from "../utils/events/common";
import { requiredEventArgs } from "../utils/events/truffle";
import { BNish, fail } from "../utils/helpers";
import { web3DeepNormalize } from "../utils/web3normalize";
import { MockChainWallet } from "./MockChain";
import { MockIndexer } from "./MockIndexer";

export class Minter {
    constructor(
        public context: IAssetAgentBotContext,
        public address: string,
        public underlyingAddress: string,
        public wallet: IBlockChainWallet
    ) {
    }

    get assetManager() {
        return this.context.assetManager;
    }

    get attestationProvider() {
        return this.context.attestationProvider;
    }

    static async createTest(ctx: IAssetAgentBotContext, address: string, underlyingAddress: string, underlyingBalance: BN): Promise<Minter> {
        if (!(ctx.blockchainIndexer instanceof MockIndexer)) fail("only for mock chains");
        ctx.blockchainIndexer.chain.mint(underlyingAddress, underlyingBalance);
        const wallet = new MockChainWallet(ctx.blockchainIndexer.chain);
        return Minter.create(ctx, address, underlyingAddress, wallet);
    }

    static async create(ctx: IAssetAgentBotContext, address: string, underlyingAddress: string, wallet: IBlockChainWallet): Promise<Minter> {
        return new Minter(ctx, address, underlyingAddress, wallet);
    }

    async reserveCollateral(agent: string, lots: BNish) {
        const agentInfo = await this.assetManager.getAgentInfo(agent);
        const crFee = await this.getCollateralReservationFee(lots);
        const res = await this.assetManager.reserveCollateral(agent, lots, agentInfo.feeBIPS, { from: this.address, value: crFee });
        return requiredEventArgs(res, 'CollateralReserved');
    }

    async performMintingPayment(crt: EventArgs<CollateralReserved>): Promise<string> {
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        return this.performPayment(crt.paymentAddress, paymentAmount, crt.paymentReference);
    }

    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string) {
        const proof = await this.proveMintingPayment(crt.paymentAddress, transactionHash);
        console.log(proof);
        return await this.executeProvedMinting(crt.collateralReservationId, proof);
    }

    async waitForTransactionFinalization(transactionHash: string) {
        await this.context.blockchainIndexer.waitForUnderlyingTransactionFinalization(transactionHash);
    }

    async proveMintingPayment(paymentAddress: string, transactionHash: string) {
        await this.waitForTransactionFinalization(transactionHash);
        return await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, paymentAddress);
    }

    async executeProvedMinting(collateralReservationId: BNish, proof: Payment.Proof) {
        const res = await this.assetManager.executeMinting(web3DeepNormalize(proof), String(collateralReservationId), { from: this.address });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async getCollateralReservationFee(lots: BNish): Promise<BN> {
        return await this.assetManager.collateralReservationFee(lots);
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null): Promise<string> {
        return this.wallet.addTransaction(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference);
    }
}
