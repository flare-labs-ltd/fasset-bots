import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from "axios";
import chalk from "chalk";
import { DEFAULT_TIMEOUT } from "./helpers";
import { logger } from "./logger";
import { formatArgs, squashSpace } from "./formatting";
import BN from "bn.js";
// agent status and settings
const CCB_TITLE = "CCB";
const LIQUIDATION_STARTED = "LIQUIDATION STARTED";
const FULL_LIQUIDATION_TITLE = "FULL LIQUIDATION";
const LIQUIDATION_WAS_PERFORMED = "LIQUIDATION WAS PERFORMED";
const AGENT_DESTROYED = "AGENT DESTROYED";
const AGENT_CREATED = "AGENT CREATED";
const AGENT_SETTING_UPDATE = "AGENT SETTING UPDATE";
const AGENT_SETTING_UPDATE_FAILED = "AGENT SETTING UPDATE FAILED";
const AGENT_ENTER_AVAILABLE = "AGENT ENTERED AVAILABLE";
const AGENT_EXIT_AVAILABLE = "AGENT EXITED AVAILABLE";
const AGENT_EXIT_AVAILABLE_ANNOUNCEMENT = "AGENT ANNOUNCED EXIT AVAILABLE";
const AGENT_ANNOUNCE_DESTROY = "AGENT ANNOUNCE DESTROY";
const SELF_CLOSE = "SELF CLOSE";

// minting
const MINTING_CORNER_CASE = "MINTING";
const MINTING_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR MINTING";
const MINTING_EXECUTED = "MINTING EXECUTED";
const MINTING_DELETED = "MINTING DELETED";
const MINTING_STARTED = "MINTING STARTED";

// redemption
const REDEMPTION_CORNER_CASE = "REDEMPTION";
const REDEMPTION_FAILED_BLOCKED = "REDEMPTION FAILED OR BLOCKED";
const REDEMPTION_DEFAULTED = "REDEMPTION DEFAULTED";
const REDEMPTION_PERFORMED = "REDEMPTION WAS PERFORMED";
const REDEMPTION_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR REDEMPTION";
const REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED = "NO ADDRESS VALIDITY PROOF OBTAINED FOR REDEMPTION";
const REDEMPTION_CONFLICTING_ADDRESS_VALIDITY_PROOF_OBTAINED = "CONFLICTING ADDRESS VALIDITY PROOF OBTAINED FOR REDEMPTION";
const REDEMPTION_STARTED = "REDEMPTION STARTED";
const REDEMPTION_PAID = "REDEMPTION PAID";
const REDEMPTION_PAYMENT_PROOF = "REDEMPTION PAYMENT PROOF REQUESTED";

// collateral
const AGENT_COLLATERAL_TOP_UP = "AGENT'S COLLATERAL TOP UP";
const POOL_COLLATERAL_TOP_UP = "POOL'S COLLATERAL TOP UP";
const AGENT_COLLATERAL_TOP_UP_FAILED = "AGENT'S COLLATERAL TOP UP FAILED";
const POOL_COLLATERAL_TOP_UP_FAILED = "POOL'S COLLATERAL TOP UP FAILED";
const WITHDRAW_VAULT_COLLATERAL = "VAULT COLLATERAL WITHDRAWAL";
const WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT = "VAULT COLLATERAL WITHDRAWAL ANNOUNCEMENT";
const WITHDRAWAL_FAILED = "COLLATERAL WITHDRAWAL FAILED";
const CANCEL_WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT = "CANCEL VAULT COLLATERAL WITHDRAWAL ANNOUNCEMENT";

// underlying
const LOW_AGENT_FREE_UNDERLYING_BALANCE = "LOW FREE UNDERLYING BALANCE";
const LOW_OWNERS_NATIVE_BALANCE = "LOW BALANCE IN OWNER'S ADDRESS";
const LOW_OWNERS_UNDERLYING_BALANCE = "LOW BALANCE IN OWNER'S UNDERLYING ADDRESS";
const CONFIRM_WITHDRAW_UNDERLYING = "CONFIRM UNDERLYING WITHDRAWAL ANNOUNCEMENT";
const CANCEL_WITHDRAW_UNDERLYING = "CANCEL UNDERLYING WITHDRAWAL ANNOUNCEMENT";
const ACTIVE_WITHDRAWAL = "ACTIVE WITHDRAWAL";
const NO_ACTIVE_WITHDRAWAL = "NO ACTIVE WITHDRAWAL";
const ANNOUNCE_WITHDRAW_UNDERLYING = "ANNOUNCE UNDERLYING WITHDRAWAL";
const WITHDRAW_UNDERLYING = "UNDERLYING WITHDRAWAL";

// pool
const BUY_POOL_TOKENS = "BUY POOL TOKENS";
const VAULT_COLLATERAL_DEPOSIT = "VAULT COLLATERAL DEPOSIT";
const WITHDRAW_POOL_FEES = "POOL FEES WITHDRAWAL";
const BALANCE_POOL_FEES = "BALANCE POOL FEES";
const POOL_DELEGATE = "POOL DELEGATION";
const POOL_UNDELEGATE = "POOL UNDELEGATION";
const CANCEL_POOL_TOKEN_ANNOUNCEMENT = "CANCEL POOL TOKEN REDEMPTION ANNOUNCEMENT";
const REDEEM_POOL_TOKEN_ANNOUNCEMENT = "REDEEM POOL TOKENS ANNOUNCEMENT";
const REDEEM_POOL_TOKEN = "POOL TOKENS REDEMPTION";

// other
const DAILY_TASK_NO_PROOF_OBTAINED = "NO PROOF OBTAINED FOR DAILY TASK";

// challenger
const ILLEGAL_TRANSACTION_CHALLENGE = "ILLEGAL TRANSACTION CHALLENGE";
const DOUBLE_PAYMENT_CHALLENGE = "DOUBLE PAYMENT CHALLENGE";
const FREE_BALANCE_NEGATIVE_CHALLENGE = "FREE BALANCE NEGATIVE CHALLENGE";

// liquidator
const AGENT_LIQUIDATED = "AGENT LIQUIDATED";

export enum BotType {
    AGENT = "agent",
    LIQUIDATOR = "liquidator",
    CHALLENGER = "challenger",
}

export enum BotLevel {
    INFO = "info",
    DANGER = "danger",
    CRITICAL = "critical",
}

interface PostAlert {
    bot_type: "string"; // agent, liquidator, challenger
    address: "string";
    level: "string"; // info, danger, critical
    title: "string";
    description: "string";
}

export class Notifier {
    client: AxiosInstance | undefined;

    constructor(public alertsUrl: string | undefined) {
        if (!alertsUrl) {
            this.client = undefined;
            return;
        }
        const createAxiosConfig: AxiosRequestConfig = {
            baseURL: alertsUrl,
            timeout: DEFAULT_TIMEOUT,
            headers: {
                "Content-Type": "application/json",
            },
            validateStatus: function (status: number) {
                /* istanbul ignore next */
                return (status >= 200 && status < 300) || status == 500;
            },
        };
        // set client
        this.client = axios.create(createAxiosConfig);
    }

    send(title: string, message?: string) {
        if (message) {
            console.log(chalk.cyan(title + ":") + " " + message);
        } else {
            console.log(chalk.cyan(title));
        }
    }

    async sendToServer(type: BotType, address: string, level: BotLevel, title: string, message?: string) {
        if (!this.client) {
            return;
        }
        const request = {
            bot_type: type,
            address: address,
            level: level,
            title: title,
            description: message,
        };
        await this.client.post<PostAlert>(`/api/0/bot_alert`, request).catch((e: AxiosError) => {
            logger.error(`Notifier error: cannot send notification ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`);
            console.error(`${chalk.red("Notifier error:")} cannot send notification (${request.level} to ${request.bot_type}) "${request.title}: ${request.description}"`)
            // throw new Error(`Notifier error: cannot send request ${formatArgs(request)}: ${e.status}: ${(e.response?.data as any)?.error}`);
        });
    }

    async sendCCBAlert(agentVault: string, timestamp: string) {
        this.send(CCB_TITLE, `Agent ${agentVault} is in collateral call band since ${timestamp}.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.DANGER, CCB_TITLE, `Agent ${agentVault} is in collateral call band since ${timestamp}.`);
    }

    async sendLiquidationStartAlert(agentVault: string, timestamp: string) {
        this.send(LIQUIDATION_STARTED, `Liquidation has started for agent ${agentVault} at ${timestamp}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            LIQUIDATION_STARTED,
            `Liquidation has started for agent ${agentVault} at ${timestamp}.`
        );
    }

    async sendFullLiquidationAlert(agentVault: string, payment1?: string, payment2?: string) {
        if (payment1 && payment2) {
            this.send(FULL_LIQUIDATION_TITLE, `Agent ${agentVault} is in full liquidation due to duplicate payment: ${payment1} and ${payment2}.`);
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.CRITICAL,
                FULL_LIQUIDATION_TITLE,
                `Agent ${agentVault} is in full liquidation due to duplicate payment: ${payment1} and ${payment2}.`
            );
        } else if (payment1) {
            this.send(FULL_LIQUIDATION_TITLE, `Agent ${agentVault} is in full liquidation due to illegal payment: ${payment1}.`);
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.CRITICAL,
                FULL_LIQUIDATION_TITLE,
                `Agent ${agentVault} is in full liquidation due to illegal payment: ${payment1}.`
            );
        } else {
            this.send(FULL_LIQUIDATION_TITLE, `Agent ${agentVault} is in full liquidation due to negative underlying free balance.`);
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.CRITICAL,
                FULL_LIQUIDATION_TITLE,
                `Agent ${agentVault} is in full liquidation due to negative underlying free balance.`
            );
        }
    }

    async sendLiquidationWasPerformed(agentVault: string, value: string) {
        this.send(LIQUIDATION_WAS_PERFORMED, `Liquidation was performed for agent ${agentVault} with value of ${value}`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            LIQUIDATION_WAS_PERFORMED,
            `Liquidation was performed for agent ${agentVault} with value of ${value}`
        );
    }

    async sendMintingCornerCase(agentVault: string, requestId: string, indexerExpired: boolean, paymentProof: boolean) {
        if (indexerExpired) {
            this.send(MINTING_CORNER_CASE, `Minting ${requestId} expired in indexer. Unstick minting was executed.`);
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.INFO,
                MINTING_CORNER_CASE,
                `Minting ${requestId} expired in indexer. Unstick minting was executed.`
            );
        } else if (paymentProof) {
            this.send(MINTING_CORNER_CASE, `Agent requested payment proof for minting ${requestId}.`);
            await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, MINTING_CORNER_CASE, `Agent requested payment proof for minting ${requestId}.`);
        } else {
            this.send(MINTING_CORNER_CASE, `Agent requested non payment proof for minting ${requestId}.`);
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.INFO,
                MINTING_CORNER_CASE,
                `Agent requested non payment proof for minting ${requestId}.`
            );
        }
    }

    async sendRedemptionCornerCase(agentVault: string, requestId: string) {
        this.send(REDEMPTION_CORNER_CASE, `Redemption ${requestId} expired in indexer. Redemption will finish without payment for agent ${agentVault}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            REDEMPTION_CORNER_CASE,
            `Redemption ${requestId} expired in indexer. Redemption will finish without payment for agent ${agentVault}.`
        );
    }

    async sendRedemptionFailedOrBlocked(requestId: string, txHash: string, redeemer: string, agentVault: string, failureReason?: string) {
        if (failureReason) {
            this.send(
                REDEMPTION_FAILED_BLOCKED,
                `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} failed due to ${failureReason} for agent ${agentVault}.`
            );
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.DANGER,
                REDEMPTION_FAILED_BLOCKED,
                `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} failed due to ${failureReason} for agent ${agentVault}.`
            );
        } else {
            this.send(
                REDEMPTION_FAILED_BLOCKED,
                `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} was blocked for agent ${agentVault}.`
            );
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.DANGER,
                REDEMPTION_FAILED_BLOCKED,
                `Redemption ${requestId} for redeemer ${redeemer} with payment transactionHash ${txHash} was blocked for agent ${agentVault}.`
            );
        }
    }

    async sendRedemptionDefaulted(requestId: string, redeemer: string, agentVault: string) {
        this.send(REDEMPTION_DEFAULTED, `Redemption ${requestId} for redeemer ${redeemer} was defaulted for agent ${agentVault}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            REDEMPTION_DEFAULTED,
            `Redemption ${requestId} for redeemer ${redeemer} was defaulted for agent ${agentVault}.`
        );
    }

    async sendRedemptionWasPerformed(requestId: string, redeemer: string, agentVault: string) {
        this.send(REDEMPTION_PERFORMED, `Redemption ${requestId} for redeemer ${redeemer} was performed for agent ${agentVault}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            REDEMPTION_PERFORMED,
            `Redemption ${requestId} for redeemer ${redeemer} was performed for agent ${agentVault}.`
        );
    }

    async sendCollateralTopUpAlert(agentVault: string, value: string, pool: boolean = false) {
        if (pool) {
            this.send(POOL_COLLATERAL_TOP_UP, `Agent ${agentVault} POOL was automatically topped up with collateral ${value} due to price changes.`);
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.INFO,
                POOL_COLLATERAL_TOP_UP,
                `Agent ${agentVault} POOL was automatically topped up with collateral ${value} due to price changes.`
            );
        } else {
            this.send(AGENT_COLLATERAL_TOP_UP, `Agent ${agentVault} was automatically topped up with collateral ${value} due to price changes.`);
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.INFO,
                AGENT_COLLATERAL_TOP_UP,
                `Agent ${agentVault} was automatically topped up with collateral ${value} due to price changes.`
            );
        }
    }

    async sendCollateralTopUpFailedAlert(agentVault: string, value: string, pool: boolean = false) {
        if (pool) {
            this.send(
                POOL_COLLATERAL_TOP_UP_FAILED,
                `Agent ${agentVault} POOL could not be automatically topped up with collateral ${value} due to price changes.`
            );
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.DANGER,
                POOL_COLLATERAL_TOP_UP_FAILED,
                `Agent ${agentVault} POOL could not be automatically topped up with collateral ${value} due to price changes.`
            );
        } else {
            this.send(
                AGENT_COLLATERAL_TOP_UP_FAILED,
                `Agent ${agentVault} could not be automatically topped up with collateral ${value} due to price changes.`
            );
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.DANGER,
                AGENT_COLLATERAL_TOP_UP_FAILED,
                `Agent ${agentVault} could not be automatically topped up with collateral ${value} due to price changes.`
            );
        }
    }

    async sendLowUnderlyingAgentBalanceFailed(agentVault: string, freeUnderlyingBalanceUBA: string) {
        this.send(
            LOW_AGENT_FREE_UNDERLYING_BALANCE,
            `Agent ${agentVault} has low freeUnderlyingBalance ${freeUnderlyingBalanceUBA} and could not be topped up.`
        );
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.DANGER,
            LOW_AGENT_FREE_UNDERLYING_BALANCE,
            `Agent ${agentVault} has low freeUnderlyingBalance ${freeUnderlyingBalanceUBA} and could not be topped up.`
        );
    }

    async sendLowUnderlyingAgentBalance(agentVault: string, amount: string) {
        this.send(LOW_AGENT_FREE_UNDERLYING_BALANCE, `Agent ${agentVault} was automatically topped up with underlying ${amount}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            LOW_AGENT_FREE_UNDERLYING_BALANCE,
            `Agent ${agentVault} was automatically topped up with underlying ${amount}.`
        );
    }

    async sendLowBalanceOnUnderlyingOwnersAddress(agentVault: string, ownerUnderlyingAddress: string, ownerUnderlyingBalance: string) {
        this.send(LOW_OWNERS_UNDERLYING_BALANCE, `Owner's underlying address ${ownerUnderlyingAddress} has low underlying ${ownerUnderlyingBalance}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            LOW_OWNERS_UNDERLYING_BALANCE,
            `Owner's underlying address ${ownerUnderlyingAddress} has low underlying ${ownerUnderlyingBalance}.`
        );
    }

    async sendLowBalanceOnOwnersAddress(agentVault: string, ownerAddress: string, balance: string, tokenSymbol: string) {
        this.send(LOW_OWNERS_NATIVE_BALANCE, `Owner ${ownerAddress} has low balance: ${balance} ${tokenSymbol}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            LOW_OWNERS_NATIVE_BALANCE,
            `Owner ${ownerAddress} has low balance: ${balance} ${tokenSymbol}.`
        );
    }

    async sendRedemptionAddressValidationNoProof(agentVault: string, requestId: string | null, roundId: number, requestData: string, address: string) {
        const msg = squashSpace`Agent ${agentVault} cannot obtain proof for address validity for redemption ${requestId}
            and address ${address} in round ${roundId} with requested data ${requestData}.`
        this.send(REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED, msg);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.DANGER, REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED, msg);
    }

    async sendRedemptionAddressValidationProofConflict(agentVault: string, requestId: string | null, roundId: number, requestData: string, address: string) {
        const msg = squashSpace`Agent ${agentVault} obtain ed conflicting proof for address validity for redemption ${requestId}
                and address ${address} in round ${roundId} with requested data ${requestData}.`;
        this.send(REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED, msg);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.DANGER, REDEMPTION_NO_ADDRESS_VALIDITY_PROOF_OBTAINED, msg);
    }

    async sendNoProofObtained(agentVault: string, requestId: string | null, roundId: number, requestData: string, redemption?: boolean) {
        if (!requestId) {
            this.send(
                DAILY_TASK_NO_PROOF_OBTAINED,
                `Agent ${agentVault} cannot obtain proof confirmed block height existence in round ${roundId} with requested data ${requestData}.`
            );
            await this.sendToServer(
                BotType.AGENT,
                agentVault,
                BotLevel.DANGER,
                DAILY_TASK_NO_PROOF_OBTAINED,
                `Agent ${agentVault} cannot obtain proof confirmed block height existence in round ${roundId} with requested data ${requestData}.`
            );
        } else {
            if (redemption) {
                this.send(
                    REDEMPTION_NO_PROOF_OBTAINED,
                    `Agent ${agentVault} cannot obtain proof for redemption ${requestId} in round ${roundId} with requested data ${requestData}.`
                );
                await this.sendToServer(
                    BotType.AGENT,
                    agentVault,
                    BotLevel.DANGER,
                    REDEMPTION_NO_PROOF_OBTAINED,
                    `Agent ${agentVault} cannot obtain proof for redemption ${requestId} in round ${roundId} with requested data ${requestData}.`
                );
            } else {
                this.send(
                    MINTING_NO_PROOF_OBTAINED,
                    `Agent ${agentVault} cannot obtain proof for minting ${requestId} in round ${roundId} with requested data ${requestData}.`
                );
                await this.sendToServer(
                    BotType.AGENT,
                    agentVault,
                    BotLevel.DANGER,
                    MINTING_NO_PROOF_OBTAINED,
                    `Agent ${agentVault} cannot obtain proof for minting ${requestId} in round ${roundId} with requested data ${requestData}.`
                );
            }
        }
    }

    async sendAgentDestroyed(agentVault: string) {
        this.send(AGENT_DESTROYED, `Agent ${agentVault} was destroyed.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, AGENT_DESTROYED, `Agent ${agentVault} was destroyed.`);
    }

    async sendAgentCreated(agentVault: string) {
        this.send(AGENT_CREATED, `Agent ${agentVault} was created.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, AGENT_CREATED, `Agent ${agentVault} was created.`);
    }

    async sendWithdrawVaultCollateral(agentVault: string, amount: string) {
        this.send(WITHDRAW_VAULT_COLLATERAL, `Agent ${agentVault} withdrew ${amount} of vault collateral.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            WITHDRAW_VAULT_COLLATERAL,
            `Agent ${agentVault} withdrew ${amount} of vault collateral.`
        );
    }

    async sendWithdrawVaultCollateralAnnouncement(agentVault: string, amount: string | BN) {
        this.send(WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT, `Agent ${agentVault} ANNOUNCED withdrawal of ${amount} for vault collateral.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT,
            `Agent ${agentVault} ANNOUNCED withdrawal of ${amount} for vault collateral.`
        );
    }

    async sendCancelVaultCollateralAnnouncement(agentVault: string) {
        this.send(CANCEL_WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT, `Agent's ${agentVault} vault collateral withdrawal announcement was successfully cancelled.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            CANCEL_WITHDRAW_VAULT_COLLATERAL_ANNOUNCEMENT,
            `Agent's ${agentVault} vault collateral withdrawal announcement was successfully cancelled.`
        );
    }

    async sendRedeemCollateralPoolTokens(agentVault: string, amount: string) {
        this.send(REDEEM_POOL_TOKEN, `Agent ${agentVault} redeemed of ${amount} pool tokens.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, REDEEM_POOL_TOKEN, `Agent ${agentVault} redeemed of ${amount} pool tokens.`);
    }

    async sendCancelRedeemCollateralPoolTokensAnnouncement(agentVault: string) {
        this.send(CANCEL_POOL_TOKEN_ANNOUNCEMENT, `Agent's ${agentVault} pool token redemption announcement was successfully cancelled.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            CANCEL_POOL_TOKEN_ANNOUNCEMENT,
            `Agent's ${agentVault} pool token redemption announcement was successfully cancelled.`
        );
    }

    async sendRedeemCollateralPoolTokensAnnouncement(agentVault: string, amount: string | BN) {
        this.send(REDEEM_POOL_TOKEN_ANNOUNCEMENT, `Agent ${agentVault} ANNOUNCED redemptions of ${amount} pool tokens.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            REDEEM_POOL_TOKEN_ANNOUNCEMENT,
            `Agent ${agentVault} ANNOUNCED redemptions of ${amount} pool tokens.`
        );
    }

    async sendAgentSettingsUpdate(agentVault: string, settingName: string) {
        this.send(AGENT_SETTING_UPDATE, `Agent ${agentVault} setting ${settingName} was updated.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, AGENT_SETTING_UPDATE, `Agent ${agentVault} setting ${settingName} was updated.`);
    }

    async sendAgentAnnouncedExitAvailable(agentVault: string) {
        this.send(AGENT_EXIT_AVAILABLE_ANNOUNCEMENT, `Agent ${agentVault} ANNOUNCED exit available list.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            AGENT_EXIT_AVAILABLE_ANNOUNCEMENT,
            `Agent ${agentVault} ANNOUNCED exit available list.`
        );
    }

    async sendAgentExitedAvailable(agentVault: string) {
        this.send(AGENT_EXIT_AVAILABLE, `Agent ${agentVault} exited available list.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, AGENT_EXIT_AVAILABLE, `Agent ${agentVault} exited available list.`);
    }

    async sendAgentEnteredAvailable(agentVault: string) {
        this.send(AGENT_ENTER_AVAILABLE, `Agent ${agentVault} entered available list.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, AGENT_ENTER_AVAILABLE, `Agent ${agentVault} entered available list.`);
    }

    async sendAgentAnnounceDestroy(agentVault: string) {
        this.send(AGENT_ANNOUNCE_DESTROY, `Agent ${agentVault} successfully announced its DESTRUCTION.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            AGENT_ANNOUNCE_DESTROY,
            `Agent ${agentVault} successfully announced its DESTRUCTION.`
        );
    }

    async sendConfirmWithdrawUnderlying(agentVault: string) {
        this.send(CONFIRM_WITHDRAW_UNDERLYING, `Agent's ${agentVault} underlying withdrawal was successfully confirmed.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            CONFIRM_WITHDRAW_UNDERLYING,
            `Agent's ${agentVault} underlying withdrawal was successfully confirmed.`
        );
    }

    async sendCancelWithdrawUnderlying(agentVault: string) {
        this.send(CANCEL_WITHDRAW_UNDERLYING, `Agent's ${agentVault} underlying withdrawal announcement was successfully cancelled.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            CANCEL_WITHDRAW_UNDERLYING,
            `Agent's ${agentVault} underlying withdrawal announcement was successfully cancelled.`
        );
    }

    async sendCollateralPoolTokensRedemption(agentVault: string) {
        this.send(REDEEM_POOL_TOKEN, `Agent ${agentVault} redeemed pool tokens.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, REDEEM_POOL_TOKEN, `Agent ${agentVault} redeemed pool tokens.`);
    }

    async sendBuyCollateralPoolTokens(agentVault: string, amount: string | BN) {
        this.send(BUY_POOL_TOKENS, `Agent ${agentVault} bought ${amount} of pool tokens successfully.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, BUY_POOL_TOKENS, `Agent ${agentVault} bought ${amount} of pool tokens successfully.`);
    }

    async sendVaultCollateralDeposit(agentVault: string, amount: string | BN) {
        this.send(VAULT_COLLATERAL_DEPOSIT, `Deposit of ${amount} to agent ${agentVault} was successful.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            VAULT_COLLATERAL_DEPOSIT,
            `Deposit of ${amount} to agent ${agentVault} was successful.`
        );
    }

    async sendWithdrawPoolFees(agentVault: string, amount: string | BN) {
        this.send(WITHDRAW_POOL_FEES, `Agent ${agentVault} withdrew pool fees ${amount} successfully.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, WITHDRAW_POOL_FEES, `Agent ${agentVault} withdrew pool fees ${amount} successfully.`);
    }

    async sendBalancePoolFees(agentVault: string, amount: string) {
        this.send(BALANCE_POOL_FEES, `Agent ${agentVault} has following pool fees balance ${amount}.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, BALANCE_POOL_FEES, `Agent ${agentVault} has following pool fees balance ${amount}.`);
    }

    async sendSelfClose(agentVault: string) {
        this.send(SELF_CLOSE, `Agent ${agentVault} self closed successfully.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, SELF_CLOSE, `Agent ${agentVault} self closed successfully.`);
    }

    async sendActiveWithdrawal(agentVault: string) {
        this.send(ACTIVE_WITHDRAWAL, `Agent ${agentVault} already has an active underlying withdrawal announcement.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            ACTIVE_WITHDRAWAL,
            `Agent ${agentVault} already has an active underlying withdrawal announcement.`
        );
    }

    async sendNoActiveWithdrawal(agentVault: string) {
        this.send(NO_ACTIVE_WITHDRAWAL, `Agent ${agentVault} has NO active underlying withdrawal announcement.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            NO_ACTIVE_WITHDRAWAL,
            `Agent ${agentVault} has NO active underlying withdrawal announcement.`
        );
    }

    async sendAnnounceUnderlyingWithdrawal(agentVault: string, paymentReference: string) {
        this.send(ANNOUNCE_WITHDRAW_UNDERLYING, `Agent ${agentVault} announced underlying withdrawal with payment reference ${paymentReference}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            ANNOUNCE_WITHDRAW_UNDERLYING,
            `Agent ${agentVault} announced underlying withdrawal with payment reference ${paymentReference}.`
        );
    }

    async sendUnderlyingWithdrawalPerformed(agentVault: string, txHash: string) {
        this.send(WITHDRAW_UNDERLYING, `Agent ${agentVault} withdrew underlying with transaction ${txHash}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            WITHDRAW_UNDERLYING,
            `Agent ${agentVault} withdrew underlying with transaction ${txHash}.`
        );
    }

    async sendMintingExecuted(agentVault: string, requestId: string) {
        this.send(MINTING_EXECUTED, `Minting ${requestId} executed for ${agentVault}.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, MINTING_EXECUTED, `Minting ${requestId} executed for ${agentVault}.`);
    }

    async sendMintingDeleted(agentVault: string, requestId: string) {
        this.send(MINTING_DELETED, `Minting ${requestId} deleted for ${agentVault}.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, MINTING_DELETED, `Minting ${requestId} deleted for ${agentVault}.`);
    }

    async sendMintingStared(agentVault: string, requestId: string) {
        this.send(MINTING_STARTED, `Minting ${requestId} started for ${agentVault}.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, MINTING_STARTED, `Minting ${requestId} started for ${agentVault}.`);
    }

    async sendRedemptionStarted(agentVault: string, requestId: string) {
        this.send(REDEMPTION_STARTED, `Redemption ${requestId} started for ${agentVault}.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, REDEMPTION_STARTED, `Redemption ${requestId} started for ${agentVault}.`);
    }

    async sendRedemptionPaid(agentVault: string, requestId: string) {
        this.send(REDEMPTION_PAID, `Redemption ${requestId} was paid for ${agentVault}.`);
        await this.sendToServer(BotType.AGENT, agentVault, BotLevel.INFO, REDEMPTION_PAID, `Redemption ${requestId} was paid for ${agentVault}.`);
    }

    async sendRedemptionRequestPaymentProof(agentVault: string, requestId: string) {
        this.send(REDEMPTION_PAYMENT_PROOF, `Payment proof for redemption ${requestId} was requested for ${agentVault}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            REDEMPTION_PAYMENT_PROOF,
            `Payment proof for redemption ${requestId} was requested for ${agentVault}.`
        );
    }

    async sendDelegatePoolCollateral(agentVault: string, poolCollateral: string, recipient: string, bips: string | BN) {
        this.send(POOL_DELEGATE, `Agent ${agentVault} delegated pool collateral ${poolCollateral} to ${recipient} with ${bips}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            POOL_DELEGATE,
            `Agent ${agentVault} delegated pool collateral ${poolCollateral} to ${recipient} with ${bips}.`
        );
    }

    async sendUndelegatePoolCollateral(agentVault: string, poolCollateral: string) {
        this.send(POOL_UNDELEGATE, `Agent ${agentVault} undelegated all pool collateral ${poolCollateral}.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            POOL_UNDELEGATE,
            `Agent ${agentVault} undelegated all pool collateral ${poolCollateral}.`
        );
    }

    async sendAgentCannotUpdateSettingExpired(agentVault: string, setting: string) {
        this.send(AGENT_SETTING_UPDATE_FAILED, `Agent ${agentVault} could not update setting ${setting}, as it is not valid anymore. Try announcing setting update again.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            AGENT_SETTING_UPDATE_FAILED,
            `Agent ${agentVault} could not update setting ${setting}, as it is not valid anymore.`
        );
    }

    async sendIllegalTransactionChallenge(challenger: string, agentVault: string, transactionHash: string) {
        this.send(
            ILLEGAL_TRANSACTION_CHALLENGE,
            `Challenger ${challenger} successfully challenged agent ${agentVault} for illegal transaction ${transactionHash}.`
        );
        await this.sendToServer(
            BotType.CHALLENGER,
            challenger,
            BotLevel.INFO,
            ILLEGAL_TRANSACTION_CHALLENGE,
            `Challenger ${challenger} successfully challenged agent ${agentVault} for illegal transaction ${transactionHash}.`
        );
    }

    async sendDoublePaymentChallenge(challenger: string, agentVault: string, transactionHash1: string, transactionHash2: string) {
        this.send(
            DOUBLE_PAYMENT_CHALLENGE,
            `Challenger ${challenger} successfully challenged agent ${agentVault} for double payments for ${transactionHash1} and ${transactionHash2}.`
        );
        await this.sendToServer(
            BotType.CHALLENGER,
            challenger,
            BotLevel.INFO,
            DOUBLE_PAYMENT_CHALLENGE,
            `Challenger ${challenger} successfully challenged agent ${agentVault} for double payments for ${transactionHash1} and ${transactionHash2}.`
        );
    }

    async sendFreeBalanceNegative(challenger: string, agentVault: string) {
        this.send(FREE_BALANCE_NEGATIVE_CHALLENGE, `Challenger ${challenger} successfully challenged agent ${agentVault} for free negative balance.`);
        await this.sendToServer(
            BotType.CHALLENGER,
            challenger,
            BotLevel.INFO,
            FREE_BALANCE_NEGATIVE_CHALLENGE,
            `Challenger ${challenger} successfully challenged agent ${agentVault} for free negative balance.`
        );
    }

    async sendAgentLiquidated(liquidator: string, agentVault: string) {
        this.send(AGENT_LIQUIDATED, `Liquidator ${liquidator} liquidated agent ${agentVault}.`);
        await this.sendToServer(BotType.LIQUIDATOR, liquidator, BotLevel.INFO, AGENT_LIQUIDATED, `Liquidator ${liquidator} liquidated agent ${agentVault}.`);
    }

    async sendAgentCannotWithdrawCollateral(agentVault: string, amount: string, type: string) {
        this.send(WITHDRAWAL_FAILED, `Agent ${agentVault} could not withdrew ${type} collateral of ${amount}. Cancel ${type} collateral withdrawal announcement and try again.`);
        await this.sendToServer(
            BotType.AGENT,
            agentVault,
            BotLevel.INFO,
            WITHDRAWAL_FAILED,
            `Agent ${agentVault} could not withdrew ${type} collateral of ${amount}.`
        );
    }
}
