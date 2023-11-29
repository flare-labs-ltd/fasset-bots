import { expect, use } from "chai";
import { initWeb3 } from "../../../src/utils/web3";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { COSTON_RPC } from "../../test-utils/test-bot-config";
import { UserBot } from "../../../src/actors/UserBot";
import { requireEnv } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
use(chaiAsPromised);

const RUN_CONFIG_PATH = requireEnv("RUN_CONFIG_PATH");

describe("UserBot cli commands unit tests", async () => {
    let accounts: string[];
    let userAddress: string;

    before(async () => {
        UserBot.userDataDir = "./test-data";
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        userAddress = accounts[2];
    });

    it("Should create UserBot", async () => {
        const userBot1 = await UserBot.create(RUN_CONFIG_PATH, "FtestXRP", false);
        expect(userBot1.nativeAddress).to.eq(userAddress);
        expect(userBot1.underlyingAddress).to.eq(undefined);
        const userBot2 = await UserBot.create(RUN_CONFIG_PATH, "FfakeXRP", true);
        expect(userBot2.nativeAddress).to.eq(userAddress);
        expect(userBot2.underlyingAddress).to.not.eq(undefined);
    });

    it("Should create UserBot - invalid 'fAssetSymbol'", async () => {
        await expect(UserBot.create(RUN_CONFIG_PATH, "invalidSymbol", true))
            .to.eventually.be.rejectedWith(`Invalid FAsset symbol`)
            .and.be.an.instanceOf(Error);
    });

    it("Should should get infoBot", async () => {
        const userBot = await UserBot.create(RUN_CONFIG_PATH, "FtestXRP", false);
        const infoBot = userBot.infoBot();
        expect(infoBot.fassetInfo.symbol).to.eq("testXRP")
    });
});
