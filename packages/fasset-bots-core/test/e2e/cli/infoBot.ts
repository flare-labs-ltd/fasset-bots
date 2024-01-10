import { expect, use } from "chai";
import { requireEnv } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { InfoBot } from "../../../src/actors/InfoBot";
use(chaiAsPromised);

const FASSET_BOT_CONFIG = requireEnv("FASSET_BOT_CONFIG");

describe("InfoBot cli commands unit tests", async () => {

    it("Should create InfoBot", async () => {
        const infoBot1 = await InfoBot.create(FASSET_BOT_CONFIG, "FtestXRP");
        expect(infoBot1.fassetInfo.symbol).to.eq("testXRP")
        const infoBot2 = await InfoBot.create(FASSET_BOT_CONFIG);
        expect(infoBot2.fassetInfo.symbol).to.eq("testXRP")
    });

    it("Should not create InfoBot", async () => {
        await expect(InfoBot.create(FASSET_BOT_CONFIG, "Invalid")).to.eventually.be.rejectedWith("FAsset does not exist");
    });
});
