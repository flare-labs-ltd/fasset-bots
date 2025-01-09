import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { CollateralReservationCancelled, CollateralReservationRejected, HandshakeRequired } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { AgentHandshake } from "../entities/agent";
import { AgentHandshakeState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { EventArgs } from "../utils/events/common";
import { errorIncluded, toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentBot } from "./AgentBot";
import { TokenBalances } from "../utils/token-balances";
import { HandshakeAddressVerifier } from "./plugins/HandshakeAddressVerifier";

type HandshakeId = { id: number } | { requestId: BN };

export class AgentBotHandshake {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
        public handshakeAddressVerifier: HandshakeAddressVerifier | null
    ) {}

    context = this.agent.context;

    /**
     * Stores received handshake in persistent state.
     * @param rootEm entity manager
     * @param request event's HandshakeRequired arguments
     */
    async handshakeRequired(rootEm: EM, request: EventArgs<HandshakeRequired>): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            em.create(
                AgentHandshake,
                {
                    state: AgentHandshakeState.STARTED,
                    agentAddress: this.agent.vaultAddress,
                    requestId: toBN(request.collateralReservationId),
                    valueUBA: toBN(request.valueUBA),
                    feeUBA: toBN(request.feeUBA),
                    minterAddress: request.minter,
                    minterUnderlyingAddresses: request.minterUnderlyingAddresses
                } as RequiredEntityData<AgentHandshake>,
                { persist: true }
            );
        });
        await this.notifier.sendHandshakeRequested(request.collateralReservationId);
        logger.info(`Agent ${this.agent.vaultAddress} handshake requested for minting ${request.collateralReservationId}.`);
    }

    /**
     * Stores handshake rejected in persistent state.
     * @param rootEm entity manager
     * @param request event's CollateralReservationRejected arguments
     */
    async mintingRejected(rootEm: EM, args: EventArgs<CollateralReservationRejected>): Promise<void> {
        await this.updateHandshake(rootEm,
            { requestId: args.collateralReservationId },
            { state: AgentHandshakeState.REJECTED }
        );
        await this.notifier.sendMintingRejected(args.collateralReservationId);
        logger.info(`Agent ${this.agent.vaultAddress} handshake rejected for minting ${args.collateralReservationId}.`);
    }

    /**
     * Stores handshake cancelled in persistent state.
     * @param rootEm entity manager
     * @param request event's CollateralReservationCancelled arguments
     */
    async mintingCancelled(rootEm: EM, args: EventArgs<CollateralReservationCancelled>): Promise<void> {
        await this.updateHandshake(rootEm,
            { requestId: args.collateralReservationId },
            { state: AgentHandshakeState.CANCELLED }
        );
        await this.notifier.sendMintingCancelled(args.collateralReservationId);
        logger.info(`Agent ${this.agent.vaultAddress} handshake cancelled for minting ${args.collateralReservationId}.`);
    }

    /**
     * @param rootEm entity manager
     */
    async handleOpenHandshakes(rootEm: EM): Promise<void> {
        try {
            const openHandshakes = await this.openHandshakes(rootEm, true);
            logger.info(`Agent ${this.agent.vaultAddress} started handling open handshakes #${openHandshakes.length}.`);
            for (const hs of openHandshakes) {
                /* istanbul ignore next */
                if (this.bot.stopRequested()) return;
                await this.executeHandshake(rootEm, {id: hs.id} );
            }
            logger.info(`Agent ${this.agent.vaultAddress} finished handling open handshakes.`);
        } catch (error) {
            console.error(`Error while handling open handshakes for agent ${this.agent.vaultAddress}: ${error}`);
            logger.error(`Agent ${this.agent.vaultAddress} run into error while handling open handshakes:`, error);
        }
    }

    /**
     * Returns handshakes with state STARTED.
     * @param em entity manager
     * @param onlyIds if true, only AgentMinting's entity ids are return
     * @return list of AgentMinting's instances
     */
    async openHandshakes(em: EM, onlyIds: boolean): Promise<AgentHandshake[]> {
        let query = em.createQueryBuilder(AgentHandshake);
        if (onlyIds) query = query.select("id");
        return await query
            .where({ agentAddress: this.agent.vaultAddress })
            .andWhere({ state: AgentHandshakeState.STARTED })
            .getResultList();
    }

    /**
     * Handles handshakes stored in persistent state according to their state.
     * @param rootEm entity manager
     * @param id AgentMinting's entity id
     */
    async executeHandshake(rootEm: EM, handshakeId: HandshakeId): Promise<void> {
        try {
            const handshake = await this.findHandshake(rootEm, handshakeId);
            if (handshake == null) throw new Error(`Handshake not found for ${handshakeId}`);
            if (handshake.state !== AgentHandshakeState.STARTED) return;
            logger.info(`Agent ${this.agent.vaultAddress} is handling open handshake ${handshake.requestId}.`);
            // check if minter address and minter underlying addresses are not sanctioned and they hold enough funds
            const fundsOk = await this.checkUnderlyingFunds(handshake.valueUBA.add(handshake.feeUBA), handshake.minterUnderlyingAddresses);
            const addressesOk = await this.checkSanctionedAddresses([
                new AddressCheck(handshake.minterAddress, this.context.nativeChainInfo.chainName),
                ...handshake.minterUnderlyingAddresses.map(address => new AddressCheck(address, this.context.chainInfo.chainId.chainName))]);
            // if OK, approve collateral reservation, else reject it
            if (fundsOk && addressesOk) {
                logger.info(`Agent ${this.agent.vaultAddress} is approving collateral reservation ${handshake.requestId}.`);
                await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                    await this.context.assetManager.approveCollateralReservation(handshake.requestId, { from: this.agent.owner.workAddress });
                });
                await this.updateHandshake(rootEm, handshakeId, {
                    state: AgentHandshakeState.APPROVED
                });
            } else {
                logger.info(`Agent ${this.agent.vaultAddress} is rejecting collateral reservation ${handshake.requestId}.`);
                await this.bot.locks.nativeChainLock(this.bot.owner.workAddress).lockAndRun(async () => {
                    await this.context.assetManager.rejectCollateralReservation(handshake.requestId, { from: this.agent.owner.workAddress });
                });
                await this.updateHandshake(rootEm, handshakeId, {
                    state: AgentHandshakeState.REJECTED
                });
            }
            logger.info(`Agent ${this.agent.vaultAddress} executed handshake for collateral reservation ${handshake.requestId}.`);
        } catch (error) {
            if (errorIncluded(error, ["invalid crt id", "handshake not required", "handshake not required or collateral reservation already approved"])) {
                await this.updateHandshake(rootEm, handshakeId, {
                    state: AgentHandshakeState.APPROVED
                });
                logger.warn(`Agent ${this.agent.vaultAddress} closed handshake ${handshakeId} because it was already approved`);
                console.log(`Agent ${this.agent.vaultAddress} closed handshake ${handshakeId} because it was already approved`);
            } else {
                console.error(`Error handling execute handshake step for minting ${handshakeId} agent ${this.agent.vaultAddress}: ${error}`);
                logger.error(`Agent ${this.agent.vaultAddress} run into error while handling execute handshake for minting ${handshakeId}:`, error);
            }
        }
    }

    /**
     * Load and update handshake object in its own transaction.
     */
    async updateHandshake(rootEm: EM, handshakeId: HandshakeId, modifications: Partial<AgentHandshake>): Promise<AgentHandshake> {
        return await this.bot.runInTransaction(rootEm, async (em) => {
            const handshake = await this.findHandshake(em, handshakeId);
            if (handshake == null) throw new Error(`Handshake not found for minting ${handshakeId}`);
            Object.assign(handshake, modifications);
            return handshake;
        });
    }

    /**
     * Returns handshake by required id from persistent state.
     * @param em entity manager
     * @param handshakeId either db id or collateral reservation id
     * @returns instance of AgentHandshake
     */
    async findHandshake(em: EM, handshakeId: HandshakeId): Promise<AgentHandshake | null> {
        if ("id" in handshakeId) {
            return await em.findOne(AgentHandshake, { id: handshakeId.id }, { refresh: true });
        } else {
            return await em.findOne(AgentHandshake, { agentAddress: this.agent.vaultAddress, requestId: handshakeId.requestId }, { refresh: true });
        }
    }

    async checkUnderlyingFunds(minFunds: BN, minterUnderlyingAddresses: string[]): Promise<boolean> {
        const balanceReader = await TokenBalances.fassetUnderlyingToken(this.context);
        const minAccountBalance = this.context.chainInfo.minimumAccountBalance;
        let balanceSum = toBN(0);
        for (const address of minterUnderlyingAddresses) {
            try {
                const balance = await balanceReader.balance(address);
                balanceSum = balanceSum.add(balance);
            }
            catch (error) {
                logger.warn(`Cannot get balance for ${address}: ${error}`);
            }
        }
        return balanceSum.gte(minFunds.add(minAccountBalance));
    }

    /**
     * Returns true if addresses are not sanctioned.
     * @param addresses The list of addresses to check
     */
    async checkSanctionedAddresses(addresses: AddressCheck[]): Promise<boolean> {
        if (this.handshakeAddressVerifier == null) return true
        for (const address of addresses) {
            logger.info(`Checking address ${address.address} on chain ${address.chainName}`);
            const sanctioned = await this.handshakeAddressVerifier.isSanctioned(address.address, address.chainName);
            if (sanctioned) {
                return false;
            }
        }
        return true;
    }
}

export class AddressCheck {
    readonly address: string;
    readonly chainName: string;

    constructor(address: string, chainName: string) {
        this.address = address;
        this.chainName = chainName;
    }
}
