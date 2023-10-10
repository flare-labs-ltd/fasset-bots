import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Minter } from "../../../src/mock/Minter";
import { BNish, fail } from "../../../src/utils/helpers";
import { SourceId } from "../../../src/verification/sources/sources";
import { Redeemer } from "../../../src/mock/Redeemer";
import { ORM } from "../../../src/config/orm";
import { AgentBot } from "../../../src/actors/AgentBot";
import { createAgentBotDefaultSettings } from "../../../src/config/BotConfig";
import { Notifier } from "../../../src/utils/Notifier";
import { TrackedState } from "../../../src/state/TrackedState";
import { Challenger } from "../../../src/actors/Challenger";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { Liquidator } from "../../../src/actors/Liquidator";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { cleanUp } from "../test-helpers";

export async function createTestMinter(ctx: IAssetAgentBotContext, address: string, useExistingUnderlyingAddress?: string) {
    if (!(ctx.chainInfo.chainId === SourceId.XRP)) fail("only for XRP testnet for now");
    const underlyingAddress = useExistingUnderlyingAddress ? useExistingUnderlyingAddress : await ctx.wallet.createAccount();
    return Minter.create(ctx, address, underlyingAddress, ctx.wallet);
}

export async function createTestRedeemer(ctx: IAssetAgentBotContext, address: string, useExistingUnderlyingAddress?: string) {
    const underlyingAddress = useExistingUnderlyingAddress ? useExistingUnderlyingAddress : await ctx.wallet.createAccount();
    return new Redeemer(ctx, address, underlyingAddress);
}

export async function createTestAgentBot(
    context: IAssetAgentBotContext,
    orm: ORM,
    ownerAddress: string,
    defaultAgentConfigPath: string,
    notifier: Notifier = new Notifier()
): Promise<AgentBot> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context, defaultAgentConfigPath);
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, notifier);
}

export async function createTestAgentBotAndDepositCollaterals(
    context: IAssetAgentBotContext,
    orm: ORM,
    ownerAddress: string,
    defaultAgentConfigPath: string,
    depositVaultCollateralAmount: BNish,
    buyPoolTokensAmount: BNish,
    notifier: Notifier = new Notifier()
): Promise<AgentBot> {
    const agentBot = await createTestAgentBot(context, orm, ownerAddress, defaultAgentConfigPath, notifier);
    // deposit class 1
    await agentBot.agent.depositVaultCollateral(depositVaultCollateralAmount);
    // buy collateral pool tokens
    await agentBot.agent.buyCollateralPoolTokens(buyPoolTokensAmount);
    return agentBot;
}

export async function createTestChallenger(address: string, state: TrackedState): Promise<Challenger> {
    return new Challenger(new ScopedRunner(), address, state, await state.context.blockchainIndexer!.getBlockHeight());
}

export async function createTestLiquidator(address: string, state: TrackedState): Promise<Liquidator> {
    return new Liquidator(new ScopedRunner(), address, state);
}

export async function createTestSystemKeeper(address: string, state: TrackedState): Promise<SystemKeeper> {
    return new SystemKeeper(new ScopedRunner(), address, state);
}

export async function destroyAllAgents(context: IAssetAgentBotContext, orm: ORM, ownerAddress: string) {
    const list = await context.assetManager.getAllAgents(0, 100);
    const listOfAgents = list[0];
    await cleanUp(context, orm, ownerAddress, listOfAgents);
}
