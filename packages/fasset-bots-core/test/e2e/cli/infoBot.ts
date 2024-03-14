import { expect, use } from "chai";
import { ZERO_ADDRESS, requireEnv } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { InfoBot } from "../../../src/actors/InfoBot";
use(chaiAsPromised);

const FASSET_BOT_CONFIG = requireEnv("FASSET_BOT_CONFIG");

describe("InfoBot cli commands unit tests", async () => {

    it("Should create InfoBot", async () => {
        const infoBot1 = await InfoBot.create(FASSET_BOT_CONFIG, "FfakeXRP");
        expect(infoBot1.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot1.context.fAsset.symbol()).to.eq("FfakeXRP");
        const infoBot2 = await InfoBot.create(FASSET_BOT_CONFIG);
        expect(infoBot2.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot2.context.fAsset.symbol()).to.eq("FtestXRP");
    });

    it("Should not create InfoBot", async () => {
        await expect(InfoBot.create(FASSET_BOT_CONFIG, "Invalid")).to.eventually.be.rejectedWith("FAsset does not exist");
    });
});
