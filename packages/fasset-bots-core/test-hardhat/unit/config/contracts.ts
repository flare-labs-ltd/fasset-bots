import { expect } from "chai";
import { loadContracts, saveContracts } from "../../../src/config/contracts";
import { existsSync, rm } from "fs";

const filename = "./fasset-deployment/coston.json";
const newFilename = "./test-hardhat/unit/config/savedContracts.json";
describe("Contracts config tests", () => {
    it("Should load contracts", async () => {
        const contracts = loadContracts(filename);
        expect(contracts.WNat.name).to.eq("WNat");
        expect(contracts.StateConnector.name).to.eq("StateConnector");
    });

    it("Should save contracts", async () => {
        const contracts = loadContracts(filename);
        // add faulty contract to trigger branch test
        contracts["invalidContract"] = undefined;
        saveContracts(newFilename, contracts);
        const exist = existsSync(newFilename);
        expect(exist).to.be.true;
        // clean up, aka delete new file
        if (exist) {
            rm(newFilename, (err) => {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log("File deleted successfully");
            });
        }
    });
});
