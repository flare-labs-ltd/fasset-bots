import { expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { expect } from "chai";
import { improveConsoleLog, preventReentrancy } from "../../../src/utils/helpers";
import { ContractSettings, MiniTruffleContract, withSettings } from "../../../src/utils/mini-truffle";
import { artifacts, contractSettings, web3 } from "../../../src/utils/web3";

describe("mini truffle and artifacts tests", async () => {
    let accounts: string[];

    before(async () => {
        improveConsoleLog();
        accounts = await web3.eth.getAccounts();
    });

    it("require with directory should work", async () => {
        const GovernanceSettings = artifacts.require("flattened/FlareSmartContracts.sol:GovernanceSettings" as "GovernanceSettings");
        expect((GovernanceSettings as MiniTruffleContract)._contractJson?.sourceName === 'flattened/FlareSmartContracts.sol');
    });

    it("require with wrong directory should fail", async () => {
        expect(() => artifacts.require("flare-smart-contracts/FlareSmartContracts.sol:GovernanceSettings" as "GovernanceSettings"))
            .to.throw("Unknown artifact flare-smart-contracts/FlareSmartContracts.sol:GovernanceSettings");
    });

    it("should deploy contracts but not interfaces", async () => {
        const GovernanceSettings = artifacts.require("GovernanceSettings");
        const governanceSettings = await GovernanceSettings.new();
        const IFtsoRegistry = artifacts.require("IFtsoRegistry");
        await expectRevert(IFtsoRegistry.new(), "The contract is abstract; cannot deploy");
    });

    async function createDeployAndCall(settings: ContractSettings) {
        const FakePriceReader = artifacts.require("FakePriceReader");
        // console.log((FakePriceReader as ContractFactory).eventDecoder);
        const fpr = await withSettings(FakePriceReader, settings).new(accounts[0]);
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

    it("should create and deploy and call a contract - default settings", async () => {
        await createDeployAndCall(contractSettings);
    });

    it("should create, deploy and call a contract - wait for receipt", async () => {
        await createDeployAndCall({ ...contractSettings, waitFor: { what: 'receipt', timeoutMS: 10_000 } });
    });

    it("should create, deploy and call a contract - wait for nonce", async () => {
        await createDeployAndCall({ ...contractSettings, waitFor: { what: 'nonceIncrease', pollMS: 1000, timeoutMS: 10_000 } });
    });

    it("should create, deploy and call a contract - wait for 3 confirmations (failure without parallel mining)", async () => {
        await expectRevert(createDeployAndCall({ ...contractSettings, waitFor: { what: 'confirmations', confirmations: 3, timeoutMS: 1000 } }),
            "Timeout waiting for finalization");
    });

    it("should create, deploy and call a contract - wait for 3 confirmations (with parallel mining)", async () => {
        const timer = setInterval(preventReentrancy(() => time.advanceBlock()), 200);
        await createDeployAndCall({ ...contractSettings, waitFor: { what: 'confirmations', confirmations: 2, timeoutMS: 5000 } });
        clearInterval(timer);
    });

    it("reverts should work", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        await expectRevert(fpr.getPrice("BTC"), "price not initialized");
    });

});
