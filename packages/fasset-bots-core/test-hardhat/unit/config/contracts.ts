import { expect } from "chai";
import { loadContracts } from "../../../src/config/contracts";

const filename = "./fasset-deployment/coston.json";

describe("Contracts config tests", () => {
    it("Should load contracts", async () => {
        const contracts = loadContracts(filename);
        expect(contracts.WNat.name).to.eq("WNat");
        expect(contracts.StateConnector.name).to.eq("StateConnector");
    });
});
