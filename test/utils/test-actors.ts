import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { Minter } from "../../src/mock/Minter";
import { fail, requireEnv } from "../../src/utils/helpers";
import { SourceId } from "../../src/verification/sources/sources";
import axios from "axios";
import { Redeemer } from "../../src/mock/Redeemer";

const accountPrivateKey = requireEnv('COSTON2_ACCOUNT_PRIVATE_KEY');
const account2PrivateKey = requireEnv('COSTON2_ACCOUNT2_PRIVATE_KEY');
const account3PrivateKey = requireEnv('COSTON2_ACCOUNT3_PRIVATE_KEY');
const account4PrivateKey = requireEnv('COSTON2_ACCOUNT4_PRIVATE_KEY');

export async function createTestMinter(ctx: IAssetBotContext, address: string) {
    if (!(ctx.chainInfo.chainId === SourceId.XRP)) fail("only for XRP testnet for now");
    const resp = await axios.post("https://faucet.altnet.rippletest.net/accounts");
    if (resp.statusText === 'OK') {
        const account = resp.data.account;
        await ctx.wallet.addExistingAccount(account.address, account.secret);
        return Minter.create(ctx, address, account.address, ctx.wallet);
    }
    throw new Error("Cannot get underlying address from testnet");
}

export async function createTestRedeemer(ctx: IAssetBotContext, address: string) {
    const underlyingAddress = await ctx.wallet.createAccount();
    return new Redeemer(ctx, address, underlyingAddress);
}

export function getCoston2AccountsFromEnv() {
    return [accountPrivateKey, account2PrivateKey, account3PrivateKey, account4PrivateKey];
}

