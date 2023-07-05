import { AgentBotDefaultSettings, IAssetAgentBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { Minter } from "../../src/mock/Minter";
import { fail, requireEnv, toBNExp } from "../../src/utils/helpers";
import { SourceId } from "../../src/verification/sources/sources";
import axios from "axios";
import { Redeemer } from "../../src/mock/Redeemer";
import { ORM } from "../../src/config/orm";
import { AgentBot } from "../../src/actors/AgentBot";
import { createAgentBotDefaultSettings } from "../../src/config/BotConfig";
import { Notifier } from "../../src/utils/Notifier";
import { mintAndDepositClass1ToOwner } from "../../test-hardhat/test-utils/helpers";

const ownerAccountPrivateKey = requireEnv('OWNER_PRIVATE_KEY');
const account1PrivateKey = requireEnv('NATIVE_ACCOUNT1_PRIVATE_KEY');
const account2PrivateKey = requireEnv('NATIVE_ACCOUNT2_PRIVATE_KEY');
const account3PrivateKey = requireEnv('NATIVE_ACCOUNT3_PRIVATE_KEY');
const deployPrivateKey = requireEnv('DEPLOY_PRIVATE_KEY');
const deposit = toBNExp(1_000_000, 18);

export async function createTestMinter(ctx: IAssetAgentBotContext, address: string) {
    if (!(ctx.chainInfo.chainId === SourceId.XRP)) fail("only for XRP testnet for now");
    const resp = await axios.post("https://faucet.altnet.rippletest.net/accounts");
    if (resp.statusText === 'OK') {
        const account = resp.data.account;
        await ctx.wallet.addExistingAccount(account.address, account.secret);
        return Minter.create(ctx, address, account.address, ctx.wallet);
    }
    throw new Error("Cannot get underlying address from testnet");
}

export async function createTestRedeemer(ctx: IAssetAgentBotContext, address: string) {
    const underlyingAddress = await ctx.wallet.createAccount();
    return new Redeemer(ctx, address, underlyingAddress);
}

export function getNativeAccountsFromEnv() {
    return [ownerAccountPrivateKey, account1PrivateKey, account2PrivateKey, account3PrivateKey, deployPrivateKey];
}

export async function createTestAgentBot(context: IAssetAgentBotContext, orm: ORM, ownerAddress: string, notifier: Notifier = new Notifier()): Promise<AgentBot> {
    const agentBotSettings: AgentBotDefaultSettings = await createAgentBotDefaultSettings(context);
    return await AgentBot.create(orm.em, context, ownerAddress, agentBotSettings, notifier);
}

export async function createTestAgentBotAndMakeAvailable(context: IAssetAgentBotContext, orm: ORM, ownerAddress: string, notifier: Notifier = new Notifier()) {
    const agentBot = await createTestAgentBot(context, orm,  ownerAddress, notifier);
    await mintAndDepositClass1ToOwner(context, agentBot.agent, deposit, ownerAddress);
    await agentBot.agent.depositClass1Collateral(deposit);
    await agentBot.agent.buyCollateralPoolTokens(deposit);
    await agentBot.agent.makeAvailable();
    return agentBot;
}