/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect } from "chai";
import { generateSecrets } from "../../../src";
import { requireEnv } from "../../../src/utils";

const FASSET_BOT_CONFIG = requireEnv("FASSET_BOT_CONFIG");

describe("Key gen cli commands unit tests", async () => {
    it("Should generate secrets", async () => {
        const agent = generateSecrets(FASSET_BOT_CONFIG, ["agent"]);
        expect(agent).to.not.be.empty;
        const other = generateSecrets(FASSET_BOT_CONFIG, ["other"]);
        expect(other).to.not.be.empty;
        const user = generateSecrets(FASSET_BOT_CONFIG, ["user"]);
        expect(user).to.not.be.empty;
    });

});
