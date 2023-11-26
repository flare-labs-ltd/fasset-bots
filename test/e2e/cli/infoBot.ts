import { expect, use } from "chai";
import { requireEnv } from "../../../src/utils/helpers";
import chaiAsPromised from "chai-as-promised";
import { InfoBot } from "../../../src/actors/InfoBot";
use(chaiAsPromised);

const RUN_CONFIG_PATH = requireEnv("RUN_CONFIG_PATH");

describe("InfoBot cli commands unit tests", async () => {

    it("Should create InfoBot", async () => {
        const infoBot1 = await InfoBot.create(RUN_CONFIG_PATH, "FtestXRP");
        expect(infoBot1.fassetInfo.symbol).to.eq("testXRP")
        const infoBot2 = await InfoBot.create(RUN_CONFIG_PATH);
        expect(infoBot2.fassetInfo.symbol).to.eq("testXRP")
    });
});
