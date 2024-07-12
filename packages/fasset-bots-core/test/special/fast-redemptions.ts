import { UserBotCommands } from "../../src";
import { Redeemer } from "../../src/mock/Redeemer";
import { sleep, toStringExp, web3 } from "../../src/utils";

async function main(args: string[]) {
    const N = Number(args[0]);
    if (!(N >= 1)) throw new Error("Missing or invalid arg N");
    const parent = await UserBotCommands.create(process.env.FASSET_BOT_SECRETS!, process.env.FASSET_BOT_CONFIG!, process.env.FASSET_DEFAULT!, process.env.FASSET_USER_DATA_DIR!);
    const lotSize = await parent.context.assetManager.lotSize();
    const redeemers: Redeemer[] = [];
    for (let i = 0; i < N; i++) {
        try {
            const account = web3.eth.accounts.create();
            web3.eth.accounts.wallet.add(account);
            const redeemer = new Redeemer(parent.context, account.address, parent.underlyingAddress);
            redeemers.push(redeemer);
            await web3.eth.sendTransaction({ from: parent.nativeAddress, to: account.address, value: toStringExp(1, 18), gas: 100_000 });
            await sleep(2000);
            await parent.context.fAsset.transfer(account.address, lotSize, { from: parent.nativeAddress });
            console.log(`Created redeemer ${i} at address ${redeemer.address}`);
        } catch (error) {
            console.error(error);
        }
    }
    await Promise.all(redeemers.map(async (redeemer, i) => {
        try {
            console.log(`Redeeming 1 lot by redeemer ${i} at ${redeemer.address}`);
            await redeemer.requestRedemption(1);
        } catch (error) {
            console.error(error);
        }
    }));
}

main(process.argv.slice(2)).catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
