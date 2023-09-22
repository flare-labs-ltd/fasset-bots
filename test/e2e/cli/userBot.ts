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
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        userAddress = accounts[2];
    });

    it("Should create UserBot", async () => {
        const userBot1 = await UserBot.create(RUN_CONFIG_PATH, "FtestXRP");
        expect(userBot1.nativeAddress).to.eq(userAddress);
        const userBot2 = await UserBot.create(RUN_CONFIG_PATH, "FfakeXRP");
        expect(userBot2.nativeAddress).to.eq(userAddress);
    });

    it("Should create UserBot - invalid 'fAssetSymbol'", async () => {
        await expect(UserBot.create(RUN_CONFIG_PATH, "invalidSymbol")).to.eventually.be.rejectedWith(`Invalid FAsset symbol`).and.be.an.instanceOf(Error);
    });
});
