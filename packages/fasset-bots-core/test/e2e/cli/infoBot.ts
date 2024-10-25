import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { InfoBotCommands } from "../../../src/commands/InfoBotCommands";
import { ZERO_ADDRESS, } from "../../../src/utils/helpers";
import { TEST_FASSET_BOT_CONFIG, TEST_SECRETS } from "../../test-utils/test-bot-config";
import { Secrets } from "../../../src/config";
use(chaiAsPromised);

describe("InfoBot cli commands unit tests", () => {
    let secrets: Secrets;
    before(async () => {
        secrets = await Secrets.load(TEST_SECRETS);
    })

    it("Should create InfoBot", async () => {
        const infoBot1 = await InfoBotCommands.create(secrets, TEST_FASSET_BOT_CONFIG, "FTestBTC");
        expect(infoBot1.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot1.context.fAsset.symbol()).to.eq("FTestBTC");
        const infoBot2 = await InfoBotCommands.create(secrets, TEST_FASSET_BOT_CONFIG, undefined);
        expect(infoBot2.context.assetManager.address).to.not.eq(ZERO_ADDRESS);
        expect(await infoBot2.context.fAsset.symbol()).to.eq("FTestXRP");
    });

    it("Should not create InfoBot", async () => {
        await expect(InfoBotCommands.create(secrets, TEST_FASSET_BOT_CONFIG, "Invalid")).to.eventually.be.rejectedWith(`FAsset "Invalid" does not exist`);
    });
});
