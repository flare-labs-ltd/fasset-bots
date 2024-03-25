import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { UserBot } from "../../../src/actors/UserBot";
import { requireEnv } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { COSTON_RPC } from "../../test-utils/test-bot-config";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
use(chaiAsPromised);

const FASSET_BOT_CONFIG = requireEnv("FASSET_BOT_CONFIG");

describe("UserBot cli commands unit tests", () => {
    let accounts: string[];
    let userAddress: string;

    before(async () => {
        UserBot.userDataDir = "./test-data";
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        userAddress = accounts[2];
    });

    it("Should create UserBot", async () => {
        const userBot1 = await UserBot.create(FASSET_BOT_CONFIG, "FtestXRP", false);
        expect(userBot1.nativeAddress).to.eq(userAddress);
        expect(userBot1.underlyingAddress).to.eq(undefined);
        const userBot2 = await UserBot.create(FASSET_BOT_CONFIG, "FfakeXRP", true);
        expect(userBot2.nativeAddress).to.eq(userAddress);
        expect(userBot2.underlyingAddress).to.not.eq(undefined);
    });

    it("Should create UserBot - invalid 'fAssetSymbol'", async () => {
        await expect(UserBot.create(FASSET_BOT_CONFIG, "invalidSymbol", true))
            .to.eventually.be.rejectedWith(`Invalid FAsset symbol`)
            .and.be.an.instanceOf(Error);
    });

    it("Should get infoBot", async () => {
        const userBot = await UserBot.create(FASSET_BOT_CONFIG, "FtestXRP", false);
        const infoBot = userBot.infoBot();
        expect(await infoBot.context.fAsset.symbol()).to.eq("FtestXRP");
    });
});
