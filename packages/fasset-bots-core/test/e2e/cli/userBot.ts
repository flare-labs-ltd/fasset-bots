import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { UserBotCommands } from "../../../src/commands/UserBotCommands";
import { PoolUserBotCommands } from "../../../src/commands/PoolUserBotCommands";
import { ZERO_ADDRESS } from "../../../src/utils/helpers";
import { initWeb3 } from "../../../src/utils/web3";
import { COSTON_RPC, TEST_FASSET_BOT_CONFIG, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { getNativeAccounts } from "../../test-utils/test-helpers";
import { Secrets } from "../../../src/config";
use(chaiAsPromised);

describe("UserBot cli commands unit tests", () => {
    let secrets: Secrets;
    let accounts: string[];
    let userAddress: string;
    const userDataDir = "./test-data";

    before(async () => {
        secrets = Secrets.load(TEST_SECRETS);
        accounts = await initWeb3(COSTON_RPC, getNativeAccounts(secrets), null);
        userAddress = accounts[2];
    });

    it("Should create UserBot", async () => {
        const userBot1 = await PoolUserBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, "FTestXRP");
        expect(userBot1.nativeAddress).to.eq(userAddress);
        const userBot2 = await UserBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, "FSimCoinX", userDataDir);
        expect(userBot2.nativeAddress).to.eq(userAddress);
        expect(userBot2.underlyingAddress).to.not.eq(ZERO_ADDRESS);
    });

    it("Should create UserBot - invalid 'fAssetSymbol'", async () => {
        await expect(UserBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, "invalidSymbol", userDataDir))
            .to.eventually.be.rejectedWith(`Invalid FAsset symbol`)
            .and.be.an.instanceOf(Error);
    });

    it("Should get infoBot", async () => {
        const userBot = await UserBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, "FTestXRP", userDataDir);
        const infoBot = userBot.infoBot();
        expect(await infoBot.context.fAsset.symbol()).to.eq("FTestXRP");
    });

    it("Should get infoBot - pool user", async () => {
        const userBot = await PoolUserBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, "FTestXRP");
        const infoBot = userBot.infoBot();
        expect(await infoBot.context.fAsset.symbol()).to.eq("FTestXRP");
    });
});
