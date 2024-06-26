import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { InfoBotCommands } from "../../../src/commands/InfoBotCommands";
import { ZERO_ADDRESS, toBN } from "../../../src/utils/helpers";
import { TEST_FASSET_BOT_CONFIG, TEST_SECRETS } from "../../test-utils/test-bot-config";
use(chaiAsPromised);

describe("InfoBot cli commands unit tests", () => {

    it("Should create InfoBot", async () => {
        const infoBot1 = await InfoBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, "FSimCoinX");
        expect(infoBot1.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot1.context.fAsset.symbol()).to.eq("FSimCoinX");
        const infoBot2 = await InfoBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, undefined);
        expect(infoBot2.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot2.context.fAsset.symbol()).to.eq("FTestXRP");
    });

    it("Should not create InfoBot", async () => {
        await expect(InfoBotCommands.create(TEST_SECRETS, TEST_FASSET_BOT_CONFIG, "Invalid")).to.eventually.be.rejectedWith(`FAsset "Invalid" does not exist`);
    });

    it.skip("Test select best agent", async () => {
        const infoBot1 = await InfoBotCommands.create("../../secrets.json", "run-config/coston-bot.json", "FTestXRP");
        const agent = await infoBot1.findBestAgent(toBN(1));
        console.log(`Best agent: ${agent}`);
    })
});
