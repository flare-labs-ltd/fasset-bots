import { AgentBot } from "../../../src/actors/AgentBot";
import { Challenger } from "../../../src/actors/Challenger";
import { Liquidator } from "../../../src/actors/Liquidator";
import { SystemKeeper } from "../../../src/actors/SystemKeeper";
import { AgentBotSettings } from "../../../src/config";
import { AgentVaultInitSettings, createAgentVaultInitSettings, loadAgentSettings } from "../../../src/config/AgentVaultInitSettings";
import { ORM } from "../../../src/config/orm";
import { IAssetAgentContext, IChallengerContext, ILiquidatorContext } from "../../../src/fasset-bots/IAssetBotContext";
import { Agent } from "../../../src/fasset/Agent";
import { Minter } from "../../../src/mock/Minter";
import { Redeemer } from "../../../src/mock/Redeemer";
import { TrackedState } from "../../../src/state/TrackedState";
import { ChainId } from "../../../src/underlying-chain/ChainId";
import { ScopedRunner } from "../../../src/utils/events/ScopedRunner";
import { fail } from "../../../src/utils/helpers";
import { NotifierTransport } from "../../../src/utils/notifier/BaseNotifier";
import { DEFAULT_POOL_TOKEN_SUFFIX } from "../../../test-hardhat/test-utils/helpers";
import { testNotifierTransports } from "../testNotifierTransports";

export async function createTestMinter(ctx: IAssetAgentContext, address: string, useExistingUnderlyingAddress?: string) {
    if (!(ctx.chainInfo.chainId === ChainId.testXRP)) fail("only for XRP testnet for now");
    const underlyingAddress = useExistingUnderlyingAddress ? useExistingUnderlyingAddress : await ctx.wallet.createAccount();
    return Minter.create(ctx, address, underlyingAddress, ctx.wallet);
}

export async function createTestRedeemer(ctx: IAssetAgentContext, address: string, useExistingUnderlyingAddress?: string) {
    const underlyingAddress = useExistingUnderlyingAddress ? useExistingUnderlyingAddress : await ctx.wallet.createAccount();
    return new Redeemer(ctx, address, underlyingAddress);
}

export async function createTestAgentBot(
    context: IAssetAgentContext,
    agentBotSettings: AgentBotSettings,
    orm: ORM,
    ownerManagementAddress: string,
    ownerUnderlyingAddress: string,
    defaultAgentConfigPath: string,
    notifiers: NotifierTransport[] = testNotifierTransports
): Promise<AgentBot> {
    const owner = await Agent.getOwnerAddressPair(context, ownerManagementAddress);
    const underlyingAddress = await AgentBot.createUnderlyingAddress(context);
    console.log(`Validating new underlying address ${underlyingAddress}...`);
    const addressValidityProof = await AgentBot.initializeUnderlyingAddress(context, owner, ownerUnderlyingAddress, underlyingAddress);
    console.log(`Creating agent bot...`);
    const settings = loadAgentSettings(defaultAgentConfigPath);
    settings.poolTokenSuffix = DEFAULT_POOL_TOKEN_SUFFIX();
    const newVaultSettings: AgentVaultInitSettings = await createAgentVaultInitSettings(context, settings);
    return await AgentBot.create(orm.em, context, agentBotSettings, owner, ownerUnderlyingAddress, addressValidityProof, newVaultSettings, notifiers, null);
}

export async function createTestChallenger(context: IChallengerContext, address: string, state: TrackedState): Promise<Challenger> {
    return new Challenger(context, new ScopedRunner(), address, state, await context.blockchainIndexer.getBlockHeight(), testNotifierTransports);
}

export async function createTestLiquidator(context: ILiquidatorContext, address: string, state: TrackedState): Promise<Liquidator> {
    return new Liquidator(context, new ScopedRunner(), address, state, testNotifierTransports);
}

export async function createTestSystemKeeper(address: string, state: TrackedState): Promise<SystemKeeper> {
    return new SystemKeeper(new ScopedRunner(), address, state);
}
