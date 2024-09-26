import BN from "bn.js";
import { assert } from "chai";
import { Minter } from "../../src/mock/Minter";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { Redeemer } from "../../src/mock/Redeemer";
import { IBlockChainWallet } from "../../src/underlying-chain/interfaces/IBlockChainWallet";
import { EventScope } from "../../src/utils/events/ScopedEvents";
import { EventArgs } from "../../src/utils/events/common";
import { proveAndUpdateUnderlyingBlock } from "../../src/utils/fasset-helpers";
import { expectErrors } from "../../src/utils/helpers";
import { RedemptionRequested } from "../../typechain-truffle/IIAssetManager";
import { coinFlip, getLotSize, randomChoice, randomInt } from "../test-utils/fuzzing-utils";
import { FuzzingRunner } from "./FuzzingRunner";

// debug state
let mintedLots = 0;

export class FuzzingCustomer {
    minter: Minter;
    redeemer: Redeemer;

    constructor(
        public runner: FuzzingRunner,
        public address: string,
        public underlyingAddress: string,
        public wallet: IBlockChainWallet
    ) {
        this.minter = new Minter(runner.context, address, underlyingAddress, wallet);
        this.redeemer = new Redeemer(runner.context, address, underlyingAddress);
    }

    get name() {
        return this.runner.eventFormatter.formatAddress(this.address);
    }

    agentName(agentVault: string) {
        return this.runner.eventFormatter.formatAddress(agentVault);
    }

    static async createTest(runner: FuzzingRunner, address: string, underlyingAddress: string, underlyingBalance: BN) {
        const chain = runner.context.blockchainIndexer.chain;
        if (!(chain instanceof MockChain)) assert.fail("only for mock chains");
        chain.mint(underlyingAddress, underlyingBalance);
        const wallet = new MockChainWallet(chain);
        return new FuzzingCustomer(runner, address, underlyingAddress, wallet);
    }

    async fAssetBalance() {
        return await this.runner.context.fAsset.balanceOf(this.address);
    }

    async minting(scope: EventScope) {
        await proveAndUpdateUnderlyingBlock(this.runner.context.attestationProvider, this.runner.context.assetManager, this.address);
        // create CR
        const agent = randomChoice(this.runner.availableAgentBots);
        const lots = randomInt(Number(agent.freeCollateralLots));
        if (this.runner.avoidErrors && lots === 0) return;
        const crt = await this.minter
            .reserveCollateral(agent.agentVault, lots)
            .catch((e) => scope.exitOnExpectedError(e,
                ["cannot mint 0 lots", "not enough free collateral", "inappropriate fee amount", "rc: invalid agent status"],
                "USER", this.minter.address));
        // pay
        let txHash = null;
        if (coinFlip(0.8)) {
            txHash = await this.minter.performMintingPayment(crt);
            // wait for finalization
            await this.runner.context.blockchainIndexer.waitForUnderlyingTransactionFinalization(txHash);
            // execute
            await this.minter.executeMinting(crt, txHash)
                .catch((e) => scope.exitOnExpectedError(e, ["payment failed"], "USER", this.minter.address)); // 'payment failed' can happen if there are several simultaneous payments and this one makes balance negative
            mintedLots += lots;
            this.runner.comment(`minting ${crt.collateralReservationId} executed with ${this.agentName(agent.agentVault)}`, `${this.name}`);
        } else {
            this.runner.comment(`minting ${crt.collateralReservationId} only initiated with ${this.agentName(agent.agentVault)}`, `${this.name}`);
            return;
        }
    }

    async redemption(scope: EventScope) {
        const lotSize = getLotSize(await this.runner.context.assetManager.getSettings());
        // request redemption
        const holdingUBA = await this.fAssetBalance();
        const holdingLots = Number(holdingUBA.div(lotSize));
        const lots = randomInt(this.runner.avoidErrors ? holdingLots : 100);
        this.runner.comment(`lots ${lots}   total minted ${mintedLots}   holding ${holdingLots}`, `${this.name}`);
        if (this.runner.avoidErrors && lots === 0) return;
        const [tickets, remaining] = await this.redeemer.requestRedemption(lots)
            .catch((e) => scope.exitOnExpectedError(e, ["f-asset balance too low", "redeem 0 lots"], "USER", this.redeemer.address));
        mintedLots -= lots - Number(remaining);
        this.runner.comment(`redeeming ${tickets.length} tickets, remaining ${remaining} lots`, `${this.name}`);
        // wait for all redemption payments or non-payments
        /*
        await foreachAsyncParallel(tickets, async ticket => {
            // detect if default happened during wait
            const redemptionDefaultPromise = this.assetManagerEvent('RedemptionDefault', { requestId: ticket.requestId }).immediate().wait(scope);
            const redemptionDefault = promiseValue(redemptionDefaultPromise);
            // wait for payment or timeout
            const event = await Promise.race([
                this.chainEvents.transactionEvent({ reference: ticket.paymentReference, to: this.underlyingAddress }).qualified('paid').wait(scope),
                this.waitForPaymentTimeout(scope, ticket),
            ]);
            if (event.name === 'paid') {
                const [targetAddress, amountPaid] = event.args.outputs[0];
                const expectedAmount = ticket.valueUBA.sub(ticket.feeUBA);
                if (amountPaid.gte(expectedAmount) && targetAddress === this.underlyingAddress) {
                    this.runner.comment(`${this.name}, req=${ticket.requestId}: Received redemption ${Number(amountPaid) / Number(lotSize)}`);
                } else {
                    this.runner.comment(`${this.name}, req=${ticket.requestId}: Invalid redemption, paid=${formatBN(amountPaid)} expected=${expectedAmount} target=${targetAddress}`);
                    await this.waitForPaymentTimeout(scope, ticket);    // still have to wait for timeout to be able to get non payment proof from SC
                    if (!redemptionDefault.resolved) {   // do this only if the agent has not already submitted failed payment and defaulted
                        await this.redemptionDefault(scope, ticket);
                    }
                    const result = await redemptionDefaultPromise; // now it must be fulfiled, by agent or by customer's default call
                    this.runner.comment(`${this.name}, req=${ticket.requestId}: default received vault collateral=${formatBN(result.redeemedVaultCollateralWei)} pool=${formatBN(result.redeemedPoolCollateralWei)}`);
                }
            } else {
                this.runner.comment(`${this.name}, req=${ticket.requestId}: Missing redemption, reference=${ticket.paymentReference}`);
                await this.redemptionDefault(scope, ticket);
            }
        });*/
    }
    /*
        private async waitForPaymentTimeout(scope: EventScope, ticket: EventArgs<RedemptionRequested>): Promise<QualifiedEvent<"timeout", null>> {
            // both block number and timestamp must be large enough
            await Promise.all([
                this.timeline.underlyingBlockNumber(Number(ticket.lastUnderlyingBlock) + 1).wait(scope),
                this.timeline.underlyingTimestamp(Number(ticket.lastUnderlyingTimestamp) + 1).wait(scope),
            ]);
            // after that, we have to wait for finalization
            await this.timeline.underlyingBlocks(this.context.chain.finalizationBlocks).wait(scope);
            return qualifiedEvent('timeout', null);
        }
    */
    async redemptionDefault(scope: EventScope, ticket: EventArgs<RedemptionRequested>) {
        this.runner.comment(`req=${ticket.requestId}: starting default, block=${(this.runner.context.blockchainIndexer.chain as MockChain).blockHeight()}`, `${this.name}`);
        const result = await this.redeemer.redemptionPaymentDefault(ticket)
            .catch((e) => expectErrors(e, ["invalid request id"])) // can happen if agent confirms failed payment
            .catch((e) => scope.exitOnExpectedError(e, [], "USER", this.redeemer.address));
        return result;
    }
}
