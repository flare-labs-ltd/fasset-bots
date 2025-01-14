import { Payment } from "@flarenetwork/state-connector-protocol";
import BN from "bn.js";
import { CollateralReserved } from "../../typechain-truffle/IIAssetManager";
import { IAssetAgentContext } from "../fasset-bots/IAssetBotContext";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { EventArgs, EvmEvent } from "../utils/events/common";
import { requiredEventArgs } from "../utils/events/truffle";
import { BNish, MAX_BIPS, ZERO_ADDRESS, fail, requireNotNull, sleep, toBN } from "../utils/helpers";
import { web3DeepNormalize } from "../utils/web3normalize";
import { MockChainWallet } from "./MockChain";
import { MockIndexer } from "./MockIndexer";
import { checkEvmNativeFunds, checkUnderlyingFunds } from "../utils/fasset-helpers";
import { Truffle } from "../../typechain-truffle/types";
import { Web3ContractEventDecoder } from "../utils/events/Web3ContractEventDecoder";
import { web3 } from "../utils/web3";

export class Minter {
    static deepCopyWithObjectCreate = true;

    constructor(
        public context: IAssetAgentContext,
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

    static async createTest(ctx: IAssetAgentContext, address: string, underlyingAddress: string, underlyingBalance: BN): Promise<Minter> {
        if (!(ctx.blockchainIndexer instanceof MockIndexer)) fail("only for mock chains");
        ctx.blockchainIndexer.chain.mint(underlyingAddress, underlyingBalance);
        const wallet = new MockChainWallet(ctx.blockchainIndexer.chain);
        return Minter.create(ctx, address, underlyingAddress, wallet);
    }

    static async create(ctx: IAssetAgentContext, address: string, underlyingAddress: string, wallet: IBlockChainWallet): Promise<Minter> {
        return new Minter(ctx, address, underlyingAddress, wallet);
    }

    async reserveCollateral(agent: string, lots: BNish, executorAddress?: string, executorFeeNatWei?: BNish) {
        const res = await this._reserveCollateral(agent, lots, true, executorAddress, executorFeeNatWei);
        return requiredEventArgs(res, 'CollateralReserved');
    }

    async reserveCollateralHandshake(agent: string, lots: BNish, executorAddress?: string, executorFeeNatWei?: BNish, checkUnderlyingAddressFunds: boolean = true) {
        const res = await this._reserveCollateral(agent, lots, checkUnderlyingAddressFunds, executorAddress, executorFeeNatWei);
        return requiredEventArgs(res, 'HandshakeRequired');
    }

    async _reserveCollateral(agent: string, lots: BNish, checkUnderlyingAddressFunds: boolean, executorAddress?: string, executorFeeNatWei?: BNish) {
        const agentInfo = await this.assetManager.getAgentInfo(agent);
        const settings = await this.assetManager.getSettings();
        const crFee = await this.getCollateralReservationFee(lots);
        const executor = executorAddress ? executorAddress : ZERO_ADDRESS;
        const totalNatFee = executor != ZERO_ADDRESS ? crFee.add(toBN(requireNotNull(executorFeeNatWei, "executor fee required if executor used"))) : crFee;
        // check funds before reserveCollateral
        await checkEvmNativeFunds(this.context, this.address, totalNatFee);
        const lotSizeUBA = toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
        const lotAmount =  toBN(lots).mul(lotSizeUBA);
        const mintPayment = lotAmount.add(lotAmount.mul(toBN(agentInfo.feeBIPS)).divn(MAX_BIPS));
        if (checkUnderlyingAddressFunds) {
            await checkUnderlyingFunds(this.context, this.underlyingAddress, mintPayment, agentInfo.underlyingAddressString);
        }
        return await this.assetManager.reserveCollateral(agent, lots, agentInfo.feeBIPS, executor, [this.underlyingAddress], { from: this.address, value: totalNatFee });
    }

    async cancelCollateralReservation(collateralReservationId: BNish) {
        const res = await this.assetManager.cancelCollateralReservation(collateralReservationId, { from: this.address });
        return requiredEventArgs(res, 'CollateralReservationCancelled');
    }

    async performMintingPayment(crt: EventArgs<CollateralReserved>): Promise<string> {
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        return this.performPayment(crt.paymentAddress, paymentAmount, crt.paymentReference, toBN(crt.lastUnderlyingBlock).toNumber(), toBN(crt.lastUnderlyingTimestamp));
    }

    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string) {
        const proof = await this.proveMintingPayment(crt.paymentAddress, transactionHash);
        return await this.executeProvedMinting(crt.collateralReservationId, proof, crt.executor);
    }

    async waitForTransactionFinalization(transactionHash: string) {
        await this.context.blockchainIndexer.waitForUnderlyingTransactionFinalization(transactionHash);
    }

    async isTransactionFinalized(transactionHash: string) {
        const transaction = await this.context.blockchainIndexer.getTransaction(transactionHash);
        return transaction != null; // when transaction appears in indexer, it must be finalized
    }

    async proveMintingPayment(paymentAddress: string, transactionHash: string) {
        await this.waitForTransactionFinalization(transactionHash);
        return await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, paymentAddress);
    }

    async requestPaymentProof(paymentAddress: string, transactionHash: string) {
        return await this.context.attestationProvider.requestPaymentProof(transactionHash, this.underlyingAddress, paymentAddress);
    }

    async obtainPaymentProof(roundId: number, requestData: string) {
        return await this.context.attestationProvider.obtainPaymentProof(roundId, requestData);
    }

    async executeProvedMinting(collateralReservationId: BNish, proof: Payment.Proof, executorAddress: string) {
        const executor = executorAddress != ZERO_ADDRESS ? executorAddress : this.address;
        const res = await this.assetManager.executeMinting(web3DeepNormalize(proof), String(collateralReservationId), { from: executor });
        return requiredEventArgs(res, 'MintingExecuted');
    }

    async getCollateralReservationFee(lots: BNish): Promise<BN> {
        return await this.assetManager.collateralReservationFee(lots);
    }

    async performPayment(paymentAddress: string, paymentAmount: BNish, paymentReference: string | null = null, executeUntilBlock?: number, executeUntilTimestamp?: BN): Promise<string> {
        await checkUnderlyingFunds(this.context, this.underlyingAddress, paymentAmount, paymentAddress);
        return this.wallet.addTransactionAndWaitForItsFinalization(this.underlyingAddress, paymentAddress, paymentAmount, paymentReference, { executeUntilBlock, executeUntilTimestamp });
    }

    async waitForEvent(contract: Truffle.ContractInstance, fromBlock: number, maxWaitMs: number, predicate: (event: EvmEvent) => boolean) {
        const sleepTime = 1000;
        const eventDecoder = new Web3ContractEventDecoder({ contract });
        for (let t = 0; t < maxWaitMs; t += sleepTime) {
            const toBlock = await web3.eth.getBlockNumber();
            if (fromBlock <= toBlock) {
                const rawEvents = await web3.eth.getPastLogs({ address: contract.address, fromBlock, toBlock });
                const events = eventDecoder.decodeEvents(rawEvents);
                for (const event of events) {
                    if (predicate(event)) return event;
                }
                fromBlock = toBlock + 1;
            }
            await sleep(sleepTime);
        }
        return null;
    }
}
