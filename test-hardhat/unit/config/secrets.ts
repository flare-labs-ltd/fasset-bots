import { expect } from "chai";
import { requireSecret } from "../../../src/config/secrets";

describe("Secrets unit tests", async () => {
    it("Should not return secret", async () => {
        const secretName = "wallet";
        const fn = () => {
            return requireSecret(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });

    it("Should not return secret 2", async () => {
        const address = requireSecret("owner.underlying_address");
        const secretName = "owner.underlying_address." + address + "." + address;
        const fn = () => {
            return requireSecret(secretName);
        };
        expect(fn).to.throw(`Secret variable ${secretName} not defined or not typeof string`);
    });
});
