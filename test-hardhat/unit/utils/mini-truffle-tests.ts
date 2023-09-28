import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { expect } from "chai";
import { improveConsoleLog, preventReentrancy, requireNotNull } from "../../../src/utils/helpers";
import { ContractSettings, MiniTruffleContract, MiniTruffleContractInstance, MiniTruffleContractsFunctions, withSettings } from "../../../src/utils/mini-truffle/contracts";
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

    it("should deploy contracts but not interfaces / abstract contracts", async () => {
        const GovernanceSettings = artifacts.require("GovernanceSettings");
        const governanceSettings = await GovernanceSettings.new();
        const IFtsoRegistry = artifacts.require("IFtsoRegistry");
        await expectRevert(IFtsoRegistry.new(), "Contract IFtsoRegistry is abstract; cannot deploy");
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
        await createDeployAndCall({ ...contractSettings, waitFor: { what: 'receipt' } });
    });

    it("should create, deploy and call a contract - wait for nonce", async () => {
        await createDeployAndCall({ ...contractSettings, waitFor: { what: 'nonceIncrease', pollMS: 1000, timeoutMS: 10_000 } });
    });

    it("should create, deploy and call a contract - wait for nonce (don't check on receipt)", async () => {
        MiniTruffleContractsFunctions.waitForFinalization.checkForNonceOnReceipt = false;
        try {
            await createDeployAndCall({ ...contractSettings, waitFor: { what: 'nonceIncrease', pollMS: 100, timeoutMS: 10_000 } });
        } finally {
            MiniTruffleContractsFunctions.waitForFinalization.checkForNonceOnReceipt = true;
        }
    });

    it("should create, deploy and call a contract - wait for 3 confirmations (failure without parallel mining)", async () => {
        await expectRevert(createDeployAndCall({ ...contractSettings, waitFor: { what: 'confirmations', confirmations: 3, timeoutMS: 1000 } }),
            "Timeout waiting for finalization");
    });

    it("should create, deploy and call a contract - wait for 3 confirmations (with parallel mining), settings on instance", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        const timer = setInterval(preventReentrancy(() => time.advanceBlock()), 200);
        const settings: ContractSettings = { ...contractSettings, waitFor: { what: 'confirmations', confirmations: 3, timeoutMS: 5000 } };
        await withSettings(fpr, settings).setDecimals("XRP", 5);
        clearInterval(timer);
        await fpr.setPrice("XRP", 1000);
        const { 0: price, 2: decimals } = await fpr.getPrice("XRP");
        expect(Number(price)).to.equal(1000);
        expect(Number(decimals)).to.equal(5);
    });

    it("should create, deploy and call a contract - wait for 2 confirmations (with parallel mining), settings on instance, don't cleanup", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        try {
            MiniTruffleContractsFunctions.waitForFinalization.cleanupHandlers = false;
            const timer = setInterval(preventReentrancy(() => time.advanceBlock()), 200);
            const settings: ContractSettings = { ...contractSettings, waitFor: { what: 'confirmations', confirmations: 2, timeoutMS: 5000 } };
            await withSettings(fpr, settings).setDecimals("XRP", 5);
            await withSettings(fpr, settings).setPrice("XRP", 800);
            clearInterval(timer);
            await fpr.setPriceFromTrustedProviders("XRP", 1000);
            const { 0: price, 2: decimals } = await fpr.getPrice("XRP");
            expect(Number(price)).to.equal(800);
            expect(Number(decimals)).to.equal(5);
            const { 0: price1, 2: decimals1 } = await fpr.getPriceFromTrustedProviders("XRP");
            expect(Number(price1)).to.equal(1000);
            expect(Number(decimals1)).to.equal(5);
        } finally {
            MiniTruffleContractsFunctions.waitForFinalization.cleanupHandlers = true;
        }
    });

    it("reverts should work", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        await expectRevert(fpr.getPrice("BTC"), "price not initialized");
    });

    it("methods .call, .sendTransaction and .estimateGas should work", async () => {
        const FtsoMock = artifacts.require("FtsoMock");
        const FtsoRegistryMock = artifacts.require("FtsoRegistryMock");
        const registry = await FtsoRegistryMock.new();
        const ftso1 = await FtsoMock.new("BTC", 5);
        const ftso2 = await FtsoMock.new("XRP", 5);
        // test .sendTransaction
        const res = await registry.addFtso.sendTransaction(ftso1.address);
        const ftsosStep1 = await registry.getSupportedSymbols();
        expect(ftsosStep1).deep.equals(["BTC"]);
        // test .call
        const index = await registry.addFtso.call(ftso2.address);
        expect(Number(index)).equals(1);
        const ftsosStep2 = await registry.getSupportedSymbols();
        expect(ftsosStep2).deep.equals(["BTC"]);
        // test .estimateGas
        const gas = await registry.addFtso.estimateGas(ftso2.address);
        expect(typeof gas).equals('number');
        expect(gas).greaterThan(20_000);
        // test direct
        const res2 = await registry.addFtso(ftso2.address);
        expect((res2.receipt as TransactionReceipt).gasUsed).equals(gas);
        const ftsosStep3 = await registry.getSupportedSymbols();
        expect(ftsosStep3).deep.equals(["BTC", "XRP"]);
    });

    it("methods .call, .sendTransaction and .estimateGas should work through .methods", async () => {
        const FtsoMock = artifacts.require("FtsoMock");
        const FtsoRegistryMock = artifacts.require("FtsoRegistryMock");
        const registry = await FtsoRegistryMock.new();
        const ftso1 = await FtsoMock.new("BTC", 5);
        const ftso2 = await FtsoMock.new("XRP", 5);
        // test .sendTransaction
        const res = await registry.methods.addFtso.sendTransaction(ftso1.address);
        const ftsosStep1 = await registry.getSupportedSymbols();
        expect(ftsosStep1).deep.equals(["BTC"]);
        // test .call
        const index = await registry.methods.addFtso.call(ftso2.address);
        expect(Number(index)).equals(1);
        const ftsosStep2 = await registry.getSupportedSymbols();
        expect(ftsosStep2).deep.equals(["BTC"]);
        // test .estimateGas
        const gas = await registry.methods.addFtso.estimateGas(ftso2.address);
        expect(typeof gas).equals('number');
        expect(gas).greaterThan(20_000);
        // test direct
        const res2 = await registry.methods.addFtso(ftso2.address);
        expect((res2.receipt as TransactionReceipt).gasUsed).equals(gas);
        const ftsosStep3 = await registry.getSupportedSymbols();
        expect(ftsosStep3).deep.equals(["BTC", "XRP"]);
    });

    it("from field must be set or default", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        const fprNoDefaultAcc = withSettings(fpr, { ...contractSettings, defaultAccount: null });
        await expectRevert(fprNoDefaultAcc.setDecimals("XRP", 5), "'from' field is mandatory");
    });

    it("at should work", async () => {
        const WNat = artifacts.require("WNat");
        const wnat = await WNat.new(accounts[0], "Native", "NAT");
        // allEvents
        const wnat2 = await WNat.at(wnat.address);
        expect(wnat2.address).equals(wnat.address);
        // methods should work
        await wnat2.deposit({ value: "10000", from: accounts[5] });
        expect(await web3.eth.getBalance(wnat.address)).equals("10000");
        expect(String(await wnat.balanceOf(accounts[5]))).equals("10000");
        expect(String(await wnat2.balanceOf(accounts[5]))).equals("10000");
    });

    it("at should fail for wrong address", async () => {
        const WNat = artifacts.require("WNat");
        await expectRevert(WNat.at(constants.ZERO_ADDRESS),
            "Cannot create instance of WNat; no code at address 0x0000000000000000000000000000000000000000");
    });

    it("linking should work", async () => {
        const CollateralTypes = artifacts.require("CollateralTypes");
        const collateralTypes = await CollateralTypes.new();
        const SettingsUpdater = artifacts.require("SettingsUpdater");
        // both link variants in typechain don't work
        expect(() => SettingsUpdater.link(CollateralTypes)).to.throw("Only supported variant is 'SettingsUpdater.link(instance)'");
        expect(() => SettingsUpdater.link("CollateralTypes", collateralTypes.address)).to.throw("Only supported variant is 'SettingsUpdater.link(instance)'");
        // typechain info is wrong on hardhat, so we have to cast to any
        SettingsUpdater.link(collateralTypes as any);
        const settingsUpdater = await SettingsUpdater.new();
    });

    it("should not link abstract contracts", async () => {
        const CollateralTypes = artifacts.require("CollateralTypes");
        const collateralTypes = await CollateralTypes.new();
        const IFtsoRegistry = artifacts.require("IFtsoRegistry");
        expect(() => IFtsoRegistry.link(collateralTypes as any)).to.throw("Contract IFtsoRegistry is abstract; cannot link");
    });

    it("should not link if contract has no link references or wrong library is linked", async () => {
        const AgentsExternal = artifacts.require("AgentsExternal");
        const agentsExternal = await AgentsExternal.new();
        const CollateralTypes = artifacts.require("CollateralTypes");
        const collateralTypes = await CollateralTypes.new();
        const SettingsUpdater = artifacts.require("SettingsUpdater") as MiniTruffleContract;
        const origBytecode = SettingsUpdater._bytecode;
        // try to link with non-dependency
        SettingsUpdater.link(agentsExternal);
        expect(SettingsUpdater._bytecode).equals(origBytecode);
        // try to link without dependencies
        SettingsUpdater._contractJson = { ...SettingsUpdater._contractJson, linkReferences: undefined };
        SettingsUpdater.link(collateralTypes);
        expect(SettingsUpdater._bytecode).equals(origBytecode);
    });

    it("unlinked contracts shouldn't deploy", async () => {
        const SettingsUpdater = artifacts.require("SettingsUpdater");
        await expectRevert(SettingsUpdater.new(), "Contract SettingsUpdater must be linked before deploy");
    });

    it("compatibility methods should work on instance", async () => {
        const WNat = artifacts.require("WNat");
        const wnat = await WNat.new(accounts[0], "Native", "NAT");
        // allEvents
        expect(() => wnat.allEvents()).to.throw("not implemented");
        // send
        await wnat.send(10_000, { from: accounts[0] });
        expect(await web3.eth.getBalance(wnat.address)).equals("10000");
        expect(() => wnat.send(10_000)).to.throw('The send transactions "from" field must be defined!');
        // send transaction
        const wnatMT = wnat as unknown as MiniTruffleContractInstance;
        const calldata = web3.eth.abi.encodeFunctionCall(requireNotNull(wnatMT.abi.find(it => it.name === 'withdraw')), ["5000"]);
        await wnat.sendTransaction({ data: calldata, from: accounts[0] });
        expect(await web3.eth.getBalance(wnat.address)).equals("5000");
    });

    it("compatibility methods should work on factory", async () => {
        const WNat = artifacts.require("WNat");
        // deployed should not work before deploy
        await expectRevert(WNat.deployed(), "Contract WNat has not been deployed");
        // deploy
        const wnat = await WNat.new(accounts[0], "Native", "NAT");
        // allEvents
        const wnat2 = await WNat.deployed();
        expect(wnat2.address).equals(wnat.address);
        // methods should work
        await wnat2.deposit({ value: "10000", from: accounts[5] });
        expect(await web3.eth.getBalance(wnat.address)).equals("10000");
        expect(String(await wnat.balanceOf(accounts[5]))).equals("10000");
        expect(String(await wnat2.balanceOf(accounts[5]))).equals("10000");
    });

    it("should not overwrite predefined fields", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader") as MiniTruffleContract;
        FakePriceReader.abi = [...FakePriceReader.abi, { type: "function", name: "address", inputs: [] }];
        const fpr = await FakePriceReader.new(accounts[0]);
        expect(typeof fpr.address).equals("string");
        expect(typeof fpr["address()"]).equals("function");
        expect(typeof fpr.methods.address).equals("function");
        expect(typeof fpr.methods["address()"]).equals("function");
    });

    it("invalid number of parameters should fail", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        await expectRevert((fpr as any).setDecimals("XRP", 5, 1, { from: accounts[0] }), "Too many arguments");
        await expectRevert((fpr as any).setDecimals("XRP"), "Not enough arguments");
    });

    it("calls should work with explicit gas and fail with too little gas", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        const gas = await fpr.setDecimals.estimateGas("XRP", 5);
        await fpr.setDecimals("XRP", 5, { gas: gas });
        await expectRevert(fpr.setDecimals("BTC", 5, { gas: Math.floor(gas / 2) }), "Transaction ran out of gas");
    });

    it("error handling in direct send transaction should work", async () => {
        const FakePriceReader = artifacts.require("FakePriceReader");
        const fpr = await FakePriceReader.new(accounts[0]);
        const calldata = web3.eth.abi.encodeFunctionCall(requireNotNull(fpr.abi.find(it => it.name === 'setPrice')), ["XRP", "5"]);
        const nonce = await web3.eth.getTransactionCount(accounts[0], 'latest');
        const promiEvent = fpr.sendTransaction({ data: calldata, from: accounts[0] });
        await expectRevert(MiniTruffleContractsFunctions.waitForFinalization(contractSettings.web3, contractSettings.waitFor, nonce, accounts[0], promiEvent),
            "price not initialized");
    });
});
