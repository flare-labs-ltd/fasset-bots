import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { UserBotCommands } from "../../../src/commands/UserBotCommands";
import { ZERO_ADDRESS } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { COSTON_RPC, TEST_FASSET_BOT_CONFIG } from "../../test-utils/test-bot-config";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
use(chaiAsPromised);

describe("UserBot cli commands unit tests", () => {
    let accounts: string[];
    let userAddress: string;

    before(async () => {
        UserBotCommands.userDataDir = "./test-data";
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        userAddress = accounts[2];
    });

    it("Should create UserBot", async () => {
        const userBot1 = await UserBotCommands.create(TEST_FASSET_BOT_CONFIG, "FtestXRP", false);
        expect(userBot1.nativeAddress).to.eq(userAddress);
        expect(userBot1.underlyingAddress).to.eq(ZERO_ADDRESS);
        const userBot2 = await UserBotCommands.create(TEST_FASSET_BOT_CONFIG, "FfakeXRP", true);
        expect(userBot2.nativeAddress).to.eq(userAddress);
        expect(userBot2.underlyingAddress).to.not.eq(ZERO_ADDRESS);
    });

    it("Should create UserBot - invalid 'fAssetSymbol'", async () => {
        await expect(UserBotCommands.create(TEST_FASSET_BOT_CONFIG, "invalidSymbol", true))
            .to.eventually.be.rejectedWith(`Invalid FAsset symbol`)
            .and.be.an.instanceOf(Error);
    });

    it("Should get infoBot", async () => {
        const userBot = await UserBotCommands.create(TEST_FASSET_BOT_CONFIG, "FtestXRP", false);
        const infoBot = userBot.infoBot();
        expect(await infoBot.context.fAsset.symbol()).to.eq("FtestXRP");
    });
});
