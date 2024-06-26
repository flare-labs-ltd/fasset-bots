import { expect } from "chai";
import { generateSecrets } from "../../../src";
import { resolveInFassetBotsCore } from "../../../src/utils";

const FASSET_BOT_CONFIG = resolveInFassetBotsCore("run-config/coston-bot.json");

describe("Key gen cli commands unit tests", () => {
    it("Should generate secrets", async () => {
        const agent = generateSecrets(FASSET_BOT_CONFIG, ["agent"], "0xAE576509E05F1CBDe1aDD5C1165fc2F10Be750B9");
        expect(agent).to.not.be.empty;
        const other = generateSecrets(FASSET_BOT_CONFIG, ["other"]);
        expect(other).to.not.be.empty;
        const user = generateSecrets(FASSET_BOT_CONFIG, ["user"]);
        expect(user).to.not.be.empty;
    });
});
