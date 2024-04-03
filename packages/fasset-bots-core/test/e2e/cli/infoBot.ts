import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { InfoBotCommands } from "../../../src/commands/InfoBotCommands";
import { ZERO_ADDRESS } from "../../../src/utils/helpers";
import { TEST_FASSET_BOT_CONFIG } from "../../test-utils/test-bot-config";
use(chaiAsPromised);

describe("InfoBot cli commands unit tests", () => {

    it("Should create InfoBot", async () => {
        const infoBot1 = await InfoBotCommands.create(TEST_FASSET_BOT_CONFIG, "FfakeXRP");
        expect(infoBot1.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot1.context.fAsset.symbol()).to.eq("FfakeXRP");
        const infoBot2 = await InfoBotCommands.create(TEST_FASSET_BOT_CONFIG);
        expect(infoBot2.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot2.context.fAsset.symbol()).to.eq("FtestXRP");
    });

    it("Should not create InfoBot", async () => {
        await expect(InfoBotCommands.create(TEST_FASSET_BOT_CONFIG, "Invalid")).to.eventually.be.rejectedWith("FAsset does not exist");
    });
});
