import util from "util";
import { toBN } from "../../../src/utils/helpers";
import { artifacts, web3 } from "../../../src/utils/web3";
import { expectEvent, expectRevert } from "@openzeppelin/test-helpers";
import { expect } from "chai";


function improveConsoleLog() {
    const BN = toBN(0).constructor;
    BN.prototype[util.inspect.custom] = function () { return `BN(${this.toString(10)})`; }
    util.inspect.defaultOptions.depth = 10;
}

describe("mini truffle and artifacts tests", async () => {
    let accounts: string[];

    before(async () => {
        improveConsoleLog();
        accounts = await web3.eth.getAccounts();
    });

    it("should deploy contracts but not interfaces", async () => {
        const GovernanceSettings = artifacts.require("GovernanceSettings");
        const governanceSettings = await GovernanceSettings.new();
        const IFtsoRegistry = artifacts.require("IFtsoRegistry");
        await expectRevert(IFtsoRegistry.new(), "The contract is abstract; cannot deploy");
    });

    async function createDeployAndCall() {
        const FakePriceReader = artifacts.require("FakePriceReader");
        // console.log((FakePriceReader as ContractFactory).eventDecoder);
        const fpr = await FakePriceReader.new(accounts[0]);
        await fpr.setDecimals("XRP", 5);
        await fpr.setPrice("XRP", 1000);
        await fpr.setPriceFromTrustedProviders("XRP", 1100);
        const res = await fpr.finalizePrices();
        expectEvent(res, 'PriceEpochFinalized');
        const { 0: price, 2: decimals } = await fpr.getPrice("XRP");
        expect(Number(price)).to.equal(1000);
        expect(Number(decimals)).to.equal(5);
        const { 0: priceT, 2: decimalsT } = await fpr.getPriceFromTrustedProviders("XRP");
        expect(Number(priceT)).to.equal(1100);
        expect(Number(decimalsT)).to.equal(5);
    }

    it("should create and deploy a contract", async () => {
        await createDeployAndCall();
    });

    it("reverts should work", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        await expectRevert(fpr.getPrice("BTC"), "price not initialized");
    });

});
