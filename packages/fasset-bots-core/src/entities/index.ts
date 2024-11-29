import { ActivityTimestampEntity } from "./activityTimestamp";
import { AgentEntity, AgentHandshake, AgentMinting, AgentRedemption, AgentUnderlyingPayment, AgentUpdateSetting, RejectedRedemptionRequest } from "./agent";

export * from "./activityTimestamp";
export * from "./agent";
export * from "./common";

export const agentBotEntities = [
    AgentEntity,
    AgentMinting,
    AgentRedemption,
    AgentUnderlyingPayment,
    AgentUpdateSetting,
    Event,
    AgentHandshake,
    RejectedRedemptionRequest
];

export const otherBotEntitites = [
    ActivityTimestampEntity
];
