import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Minter } from "../../../src/mock/Minter";
import { fail } from "../../../src/utils/helpers";
import { SourceId } from "../../../src/verification/sources/sources";
import { Redeemer } from "../../../src/mock/Redeemer";
import { ORM } from "../../../src/config/orm";
import { AgentBot } from "../../../src/actors/AgentBot";
import { createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { Notifier } from "../../../src/utils/Notifier";

export async function createTestMinter(ctx: IAssetAgentBotContext, address: string, useUnderlyingAddress?: string) {
    if (!(ctx.chainInfo.chainId === SourceId.XRP)) fail("only for XRP testnet for now");
    const underlyingAddress = useUnderlyingAddress ? useUnderlyingAddress : await ctx.wallet.createAccount();
    return Minter.create(ctx, address, underlyingAddress, ctx.wallet);
}

export async function createTestRedeemer(ctx: IAssetAgentBotContext, address: string) {
    const underlyingAddress = await ctx.wallet.createAccount();
    return new Redeemer(ctx, address, underlyingAddress);
}

export async function createTestAgentBot(context: IAssetAgentBotContext, orm: ORM, ownerAddress: string, defaultAgentConfigPath: string, notifier: Notifier = new Notifier()): Promise<AgentBot> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, defaultAgentConfigPath);
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, notifier);
}

