import { RequiredEntityData } from "@mikro-orm/core";
import BN from "bn.js";
import { CoreVaultTransferCancelled, CoreVaultTransferStarted } from "../../typechain-truffle/IIAssetManager";
import { EM } from "../config/orm";
import { TransferToCoreVault } from "../entities/agent";
import { TransferToCoreVaultState } from "../entities/common";
import { Agent } from "../fasset/Agent";
import { EventArgs } from "../utils/events/common";
import { toBN } from "../utils/helpers";
import { logger } from "../utils/logger";
import { AgentNotifier } from "../utils/notifier/AgentNotifier";
import { AgentBot } from "./AgentBot";
import { CoreVaultTransferSuccessful } from "../../typechain-truffle/CoreVaultFacet";

export class AgentBotTransferToCoreVault {
    static deepCopyWithObjectCreate = true;

    constructor(
        public bot: AgentBot,
        public agent: Agent,
        public notifier: AgentNotifier,
    ) {}

    context = this.agent.context;

    /**
     * Stores received transfer to core vault request in persistent state.
     * @param em entity manager
     * @param request event's CoreVaultTransferStarted arguments
     */
    async transferToCoreVaultStarted(rootEm: EM, request: EventArgs<CoreVaultTransferStarted>): Promise<void> {
        await this.bot.runInTransaction(rootEm, async (em) => {
            em.create(
                TransferToCoreVault,
                {
                    state: TransferToCoreVaultState.STARTED,
                    agentAddress: this.agent.vaultAddress,
                    requestId: toBN(request.transferRedemptionRequestId),
                    valueUBA: toBN(request.valueUBA),
                } as RequiredEntityData<TransferToCoreVault>,
                { persist: true }
            );
        });
        await this.notifier.sendTransferToCVStarted(request.transferRedemptionRequestId);
        logger.info(`Agent ${this.agent.vaultAddress} started transfer to core vault ${request.transferRedemptionRequestId}.`);
    }

    async transferToCoreVaultPerformed(rootEm: EM, args: EventArgs<CoreVaultTransferSuccessful>) {
        await this.updateTransferToCoreVault(rootEm, args.transferRedemptionRequestId, {
            state: TransferToCoreVaultState.DONE,
        });
        logger.info(`Agent ${this.agent.vaultAddress} performed transfer to core vault ${args.transferRedemptionRequestId.toString()}.`);
        await this.notifier.sendTransferToCVPerformed(args.transferRedemptionRequestId);
    }

    async transferToCoreVaultCancelled(rootEm: EM, args: EventArgs<CoreVaultTransferCancelled>) {
        await this.updateTransferToCoreVault(rootEm, args.transferRedemptionRequestId, {
            state: TransferToCoreVaultState.DONE,
            cancelled: true
        });
        logger.info(`Agent ${this.agent.vaultAddress} cancelled and closed transfer to core vault ${args.transferRedemptionRequestId.toString()}.`);
        await this.notifier.sendTransferToCVCancelled(args.transferRedemptionRequestId);
    }

    async updateTransferToCoreVault(rootEm: EM, rd: BN, modifications: Partial<TransferToCoreVault>): Promise<TransferToCoreVault> {
        return await this.bot.runInTransaction(rootEm, async (em) => {
            const transferToCoreVault = await this.findTransferToCoreVault(em, rd);
            Object.assign(transferToCoreVault, modifications);
            return transferToCoreVault;
        });
    }

    async findTransferToCoreVault(em: EM, requestId: BN) {
        return await em.findOneOrFail(TransferToCoreVault, { requestId }, { refresh: true });
    }
}
