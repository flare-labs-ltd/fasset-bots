import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { assert, expect } from "chai";
import fs from "fs";
import { network } from "hardhat";
import path from "path";
import { TransactionReceipt } from "web3-core";
import { improveConsoleLog, preventReentrancy, requireNotNull, sleep } from "../../../src/utils/helpers";
import { FilesystemAddressLocks, MemoryAddressLocks } from "../../../src/utils/mini-truffle-contracts/address-locks";
import { CancelToken, CancelTokenRegistration } from "../../../src/utils/mini-truffle-contracts/cancelable-promises";
import { MiniTruffleContract, MiniTruffleContractInstance, withSettings } from "../../../src/utils/mini-truffle-contracts/contracts";
import { TransactionSubmitRevertedError, waitForFinalization, waitForNonceIncrease, waitForReceipt } from "../../../src/utils/mini-truffle-contracts/finalization";
import { TransactionFailedError } from "../../../src/utils/mini-truffle-contracts/methods";
import { ContractSettings, TransactionWaitFor } from "../../../src/utils/mini-truffle-contracts/types";
import { artifacts, contractSettings, web3 } from "../../../src/utils/web3";
import { FakePriceReaderInstance } from "../../../typechain-truffle";

describe("mini truffle and artifacts tests", () => {
    const TEST_LOCK_DIR = "./test-data/locks";
    let accounts: string[];

    before(async () => {
        improveConsoleLog();
        accounts = await web3.eth.getAccounts();
    });

    describe("artifacts", () => {
        it("require should work", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            expect((FakePriceReader as MiniTruffleContract)._contractJson?.sourceName)
                .to.equal("contracts/assetManager/mock/FakePriceReader.sol");
        });

        it("require with directory should work", async () => {
            const GovernanceSettings = artifacts.require("flattened/FlareSmartContracts.sol:GovernanceSettings" as "GovernanceSettings");
            expect((GovernanceSettings as MiniTruffleContract)._contractJson?.sourceName)
                .to.equal("flattened/FlareSmartContracts.sol");
        });

        it("require with wrong directory should fail", async () => {
            expect(() => artifacts.require("flare-smart-contracts/FlareSmartContracts.sol:GovernanceSettings" as "GovernanceSettings"))
                .to.throw("Unknown artifact flare-smart-contracts/FlareSmartContracts.sol:GovernanceSettings");
        });
    });

    describe("contract calling and deploying", () => {
        it("should deploy contracts but not interfaces / abstract contracts", async () => {
            const GovernanceSettings = artifacts.require("GovernanceSettings");
            const governanceSettings = await GovernanceSettings.new();
            const IFtsoRegistry = artifacts.require("IFtsoRegistry");
            await expectRevertWithCorrectStack(IFtsoRegistry.new(), "Contract IFtsoRegistry is abstract; cannot deploy");
        });

        it("should create, deploy and call a contract", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            // console.log((FakePriceReader as ContractFactory).eventDecoder);
            const fpr = await FakePriceReader.new(accounts[0]);
            await fpr.setDecimals("XRP", 5);
            await fpr.setPrice("XRP", 1000);
            await fpr.setPriceFromTrustedProviders("XRP", 1100);
            const res = await fpr.finalizePrices();
            expectEvent(res, "PriceEpochFinalized");
            const { 0: price, 2: decimals } = await fpr.getPrice("XRP");
            expect(Number(price)).to.equal(1000);
            expect(Number(decimals)).to.equal(5);
            const { 0: priceT, 2: decimalsT } = await fpr.getPriceFromTrustedProviders("XRP");
            expect(Number(priceT)).to.equal(1100);
            expect(Number(decimalsT)).to.equal(5);
        });

        it("reverts should work", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            await expectRevertWithCorrectStack(fpr.getPrice("BTC"), "price not initialized");
            await expectRevertWithCorrectStack(fpr.setPrice("BTC", 1000, { from: accounts[0] }), "price not initialized");
            await expectRevertWithCorrectStack(fpr.setPrice.estimateGas("BTC", 1000, { from: accounts[0] }), "price not initialized");
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
            expect(typeof gas).equals("number");
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
            expect(typeof gas).equals("number");
            expect(gas).greaterThan(20_000);
            // test direct
            const res2 = await registry.methods.addFtso(ftso2.address);
            expect((res2.receipt as TransactionReceipt).gasUsed).equals(gas);
            const ftsosStep3 = await registry.getSupportedSymbols();
            expect(ftsosStep3).deep.equals(["BTC", "XRP"]);
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
            // constructor args are correct
            expect(await wnat2.governance()).equals(accounts[0]);
            expect(await wnat2.name()).equals("Native");
            expect(await wnat2.symbol()).equals("NAT");
        });

        it("at should fail for wrong address", async () => {
            const WNat = artifacts.require("WNat");
            await expectRevertWithCorrectStack(
                WNat.at(constants.ZERO_ADDRESS),
                "Cannot create instance of WNat; no code at address 0x0000000000000000000000000000000000000000"
            );
        });

        it("'from' field must be set or default", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const fprNoDefaultAcc = withSettings(fpr, { ...contractSettings, defaultAccount: null });
            await expectRevertWithCorrectStack(fprNoDefaultAcc.setDecimals("XRP", 5), "'from' field is mandatory");
        });

        it("should not overwrite predefined instance fields with methods", async () => {
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
            await expectRevertWithCorrectStack((fpr as any).setDecimals("XRP", 5, 1, { from: accounts[0] }), "Too many arguments");
            await expectRevertWithCorrectStack((fpr as any).setDecimals("XRP"), "Not enough arguments");
        });

        it("calls should work with auto or explicit gas and fail with too little gas", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const gas = await fpr.setDecimals.estimateGas("XRP", 5);
            await fpr.setDecimals("XRP", 5, { gas: gas });
            await withSettings(fpr, { gas: "auto" }).setDecimals("DOGE", 5);
            await expectRevertWithCorrectStack(fpr.setDecimals("BTC", 5, { gas: Math.floor(gas / 2) }), "Transaction ran out of gas");
        });

        it("method result format should be validated", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            await fpr.setDecimals("XRP", 6);
            await fpr.setPrice("XRP", 100000);
            // hack method ABI to make decoding wrong
            const fprCtr = fpr as unknown as MiniTruffleContractInstance;
            fprCtr.abi.find(it => it.name === "getPrice")?.outputs?.pop();
            await expectRevert(fpr.getPrice("XRP"), "Method result re-encoding mismatch. Probably versions of deployed contracts and used ABI do not agree.");
        });
    });

    describe("different finalization settings", () => {
        async function createDeployAndCall(settings: ContractSettings) {
            const FakePriceReader = artifacts.require("FakePriceReader");
            // console.log((FakePriceReader as ContractFactory).eventDecoder);
            const fpr = await withSettings(FakePriceReader, settings).new(accounts[0]);
            await fpr.setDecimals("XRP", 5);
            await fpr.setPrice("XRP", 1000);
            await fpr.setPriceFromTrustedProviders("XRP", 1100);
            const res = await fpr.finalizePrices();
            expectEvent(res, "PriceEpochFinalized");
            const { 0: price, 2: decimals } = await fpr.getPrice("XRP");
            expect(Number(price)).to.equal(1000);
            expect(Number(decimals)).to.equal(5);
            const { 0: priceT, 2: decimalsT } = await fpr.getPriceFromTrustedProviders("XRP");
            expect(Number(priceT)).to.equal(1100);
            expect(Number(decimalsT)).to.equal(5);
        }

        it("should create, deploy and call a contract - wait for receipt", async () => {
            await createDeployAndCall({ ...contractSettings, waitFor: { what: "receipt" } });
        });

        it("should create, deploy and call a contract - wait for nonce", async () => {
            await createDeployAndCall({ ...contractSettings, waitFor: { what: "nonceIncrease", pollMS: 1000, timeoutMS: 10_000 } });
        });

        it("should create, deploy and call a contract - wait for 3 confirmations (failure without parallel mining)", async () => {
            await expectRevertWithCorrectStack(
                createDeployAndCall({ ...contractSettings, waitFor: { what: "confirmations", confirmations: 3, timeoutMS: 1000 } }),
                "Timeout waiting for finalization"
            );
        });

        it("should create, deploy and call a contract - wait for 3 confirmations (with parallel mining), settings on instance", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const timer = setInterval(
                preventReentrancy(() => time.advanceBlock()) as (() => void),
                200
            );
            const settings: ContractSettings = { ...contractSettings, waitFor: { what: "confirmations", confirmations: 3, timeoutMS: 5000 } };
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
            const timer = setInterval(
                preventReentrancy(() => time.advanceBlock()) as (() => void),
                200
            );
            const settings: ContractSettings = { ...contractSettings, waitFor: { what: "confirmations", confirmations: 2, timeoutMS: 5000 } };
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
        });

        async function lowLevelExecuteMethodWithError(waitFor: TransactionWaitFor) {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const calldata = web3.eth.abi.encodeFunctionCall(requireNotNull(fpr.abi.find((it) => it.name === "setPrice")), ["XRP", "5"]);
            const nonce = await web3.eth.getTransactionCount(accounts[0], "latest");
            const promiEvent = fpr.sendTransaction({ data: calldata, from: accounts[0] });
            const cancelToken = new CancelToken();
            await waitForFinalization(111, contractSettings.web3, waitFor, nonce, accounts[0], promiEvent, cancelToken);
        }

        it("error handling in direct send transaction should work (different wait types)", async () => {
            await expectRevert(
                lowLevelExecuteMethodWithError({ what: "confirmations", confirmations: 3, timeoutMS: 10_000 }),
                "price not initialized"
            );
        });

        it("should call a contract - wait for nonce (low level, always wait at least one tick)", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const calldata = web3.eth.abi.encodeFunctionCall(requireNotNull(fpr.abi.find((it) => it.name === "setDecimals")), ["XRP", "8"]);
            const nonce = await web3.eth.getTransactionCount(accounts[0], "latest");
            const promiEvent = fpr.sendTransaction({ data: calldata, from: accounts[0] });
            const cancelToken = new CancelToken();
            const waitNonce = waitForNonceIncrease(web3, accounts[0], nonce, 500, undefined, cancelToken);
            const receipt = await waitForReceipt(promiEvent, cancelToken);
            await waitNonce; // should work
            const { 2: decimals } = await fpr.getPrice("XRP");
            expect(Number(decimals)).to.equal(8);
        });

        it("should wait for nonce and for two blocks extra", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const timer = setInterval(
                preventReentrancy(() => time.advanceBlock()) as (() => void),
                200
            );
            const settings: ContractSettings = {
                ...contractSettings,
                waitFor: { what: "nonceIncrease", pollMS: 500, timeoutMS: 10000, extra: { blocks: 2, timeMS: 3000 } }
            };
            await withSettings(fpr, settings).setDecimals("XRP", 5);
            await withSettings(fpr, settings).setPrice("XRP", 800);
            clearInterval(timer);
            const { 0: price, 2: decimals } = await fpr.getPrice("XRP");
            expect(Number(price)).to.equal(800);
            expect(Number(decimals)).to.equal(5);
        });

        it("should wait for nonce and for two blocks extra - extra time expires", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const settings: ContractSettings = {
                ...contractSettings,
                waitFor: { what: "nonceIncrease", pollMS: 500, timeoutMS: 10000, extra: { blocks: 2, timeMS: 2000 } }
            };
            await withSettings(fpr, settings).setDecimals("XRP", 5);
            await withSettings(fpr, settings).setPrice("XRP", 800);
            const { 0: price, 2: decimals } = await fpr.getPrice("XRP");
            expect(Number(price)).to.equal(800);
            expect(Number(decimals)).to.equal(5);
        });

        it("should wait for nonce and for two blocks extra - nonce decrease while waiting", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const settings: ContractSettings = {
                ...contractSettings,
                waitFor: { what: "nonceIncrease", pollMS: 500, timeoutMS: 5000, extra: { blocks: 2, timeMS: 3000 } },
                resubmitTransaction: []
            };
            // simulate network reorg with snapshot/revert
            const snapshotId = await network.provider.send("evm_snapshot", []);
            const promise = withSettings(fpr, settings).setDecimals("XRP", 5);
            await sleep(500);
            await time.advanceBlock();
            await sleep(1000);
            await network.provider.send("evm_revert", [snapshotId]);
            await expectRevert(promise, "Timeout waiting for finalization");
        });
    });

    describe("contract linking", () => {
        it("linking should work", async () => {
            const MockLibraryDep = artifacts.require("MockLibraryDep");
            const mockLibraryDep = await MockLibraryDep.new();
            const MockLibraryLink = artifacts.require("MockLibraryLink");
            // both link variants in typechain don't work
            expect(() => MockLibraryLink.link(MockLibraryDep))
                .to.throw("Only supported variant is 'MockLibraryLink.link(instance)'");
            expect(() => MockLibraryLink.link("MockLibraryDep", mockLibraryDep.address))
                .to.throw("Only supported variant is 'MockLibraryLink.link(instance)'");
            // typechain info is wrong on hardhat, so we have to cast to any
            MockLibraryLink.link(mockLibraryDep as any);
            const mockLibrary = await MockLibraryLink.new();
        });

        it("should not link abstract contracts", async () => {
            const MockLibraryDep = artifacts.require("MockLibraryDep");
            const mockLibraryDep = await MockLibraryDep.new();
            const IFtsoRegistry = artifacts.require("IFtsoRegistry");
            expect(() => IFtsoRegistry.link(mockLibraryDep as any))
                .to.throw("Contract IFtsoRegistry is abstract; cannot link");
        });

        it("should not link if contract has no link references or wrong library is linked", async () => {
            const MockLibraryNonDep = artifacts.require("MockLibraryNonDep");
            const mockLibraryNonDep = await MockLibraryNonDep.new();
            const MockLibraryDep = artifacts.require("MockLibraryDep");
            const mockLibraryDep = await MockLibraryDep.new();
            const MockLibraryLink = artifacts.require("MockLibraryLink") as MiniTruffleContract;
            const origBytecode = MockLibraryLink._bytecode;
            // try to link with non-dependency
            MockLibraryLink.link(mockLibraryNonDep);
            expect(MockLibraryLink._bytecode).equals(origBytecode);
            // try to link without dependencies
            MockLibraryLink._contractJson = { ...MockLibraryLink._contractJson, linkReferences: undefined };
            MockLibraryLink.link(mockLibraryDep);
            expect(MockLibraryLink._bytecode).equals(origBytecode);
        });

        it("unlinked contracts shouldn't deploy", async () => {
            const MockLibraryLink = artifacts.require("MockLibraryLink");
            await expectRevertWithCorrectStack(MockLibraryLink.new(), "Contract MockLibraryLink must be linked before deploy");
        });
    });

    describe("truffle compatibility", () => {
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
            const calldata = web3.eth.abi.encodeFunctionCall(requireNotNull(wnatMT.abi.find((it) => it.name === "withdraw")), ["5000"]);
            await wnat.sendTransaction({ data: calldata, from: accounts[0] });
            expect(await web3.eth.getBalance(wnat.address)).equals("5000");
        });

        it("compatibility methods should work on factory", async () => {
            const WNat = artifacts.require("WNat");
            // deployed should not work before deploy
            await expectRevertWithCorrectStack(WNat.deployed(), "Contract WNat has not been deployed");
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
    });

    describe("cancellable promises", () => {
        it("promises should be cancelled with cancel token", async () => {
            const cancelToken = new CancelToken();
            let counter = 0;
            let testCounter = 0;
            const mainTimer = setInterval(() => {
                counter++;
            }, 200);
            let testTimer: NodeJS.Timeout;
            try {
                let testRegistration: CancelTokenRegistration;
                const testCancelable = new Promise<void>((resolve, reject) => {
                    testTimer = setInterval(() => {
                        testCounter++;
                    }, 200);
                    testRegistration = cancelToken.register(reject);
                }).finally(() => {
                    cancelToken.unregister(testRegistration);
                    clearInterval(testTimer);
                });
                void testCancelable.catch(); // prevent uncought promise rejection
                assert.equal(cancelToken.registrations.size, 1);
                // check should work
                cancelToken.check();
                // wait 0.5 sec
                await sleep(500);
                // cancel test timer and take snapshots
                cancelToken.cancel();
                await sleep(0);
                const snapshotCounter = counter;
                const snapshotTestCounter = testCounter;
                expect(Math.abs(counter - testCounter)).to.be.lessThanOrEqual(1);
                // token should be cancelled now
                await expectRevertWithCorrectStack(testCancelable, "Promise cancelled");
                expect(() => cancelToken.check()).to.throw("Promise cancelled");
                // wait another sec
                await sleep(1000);
                // now main counter should have increased but test counter not
                expect(counter).greaterThan(snapshotCounter);
                expect(testCounter).equals(snapshotTestCounter);
                expect(counter - testCounter).to.be.greaterThan(1);
            } finally {
                clearInterval(mainTimer);
                clearInterval(testTimer!);
            }
        });

        it("cancel token should correctly handle already cancelled promises", async () => {
            const cancelToken = new CancelToken();
            cancelToken.cancel();
            let registration1: CancelTokenRegistration;
            const promise1 = new Promise((resolve, reject) => {
                registration1 = cancelToken.register((err) => reject(err));
            });
            assert.equal(cancelToken.registrations.size, 0);
            await expectRevertWithCorrectStack(promise1, "Promise cancelled");
            cancelToken.unregister(registration1!); // should succeed
            expect(() => cancelToken.check()).to.throw("Promise cancelled");
        });

        it("cancel token should correctly ignore null and unregistered registrations", async () => {
            const cancelToken = new CancelToken();
            // eslint-disable-next-line prefer-const
            let registration1: CancelTokenRegistration;
            cancelToken.unregister(registration1!); // uregistering undefined should succeed
            registration1 = cancelToken.register((err) => {});
            assert.equal(cancelToken.registrations.size, 1);
            cancelToken.unregister(registration1!); // should succeed
            assert.equal(cancelToken.registrations.size, 0);
            cancelToken.unregister(registration1!); // repeating should succeed
        });
    });

    describe("Error stack wrapping", () => {
        it("clean stack trace - hardhat", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const filename = path.basename(__filename);
            await fpr.getPrice("BTC").catch((e) => {
                console.error("CALL ERR", e);
                assert.include(e.stack, filename);
            });
            await withSettings(fpr, { gas: "auto" })
                .setPrice("BTC", 1000, { gas: null as any })
                .catch((e) => {
                    console.error("SEND ERR", e);
                    assert.include(e.stack, filename);
                });
            await fpr.setPrice("BTC", 1000, { gas: 1e6 }).catch((e) => {
                console.error("SEND ERR NG", e);
                assert.include(e.stack, filename);
                console.error("SEND ERR NG (full)", e.fullStack());
            });
        });
    });

    describe("submit error handling with extra blocks", () => {
        afterEach(async () => {
            await setMining("auto");
        });

        it("should wait for two blocks extra after error happens (originally wait nonce with extra)", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const settings: ContractSettings = {
                ...contractSettings,
                waitFor: { what: "nonceIncrease", pollMS: 500, timeoutMS: 10000, extra: { blocks: 2, timeMS: 5000 } },
                resubmitTransaction: []
            };
            await setMining("interval", 1000);
            // let error happen in submit
            let error: unknown;
            await withSettings(fpr, settings).setPrice("BTC", 1000, { gas: 1e6 })
                .catch(e => error = e);
            const blockNumber = await web3.eth.getBlockNumber();
            assert(error instanceof TransactionFailedError);
            assert.include(error.message, "price not initialized");
            const cause = error.errorCause;
            assert(cause instanceof TransactionSubmitRevertedError);
            const transaction = await web3.eth.getTransaction(cause.transactionHash);
            assert.isAtLeast(blockNumber, transaction.blockNumber! + 2);
        });

        it("should wait for two blocks extra after error happens, stop by time (originally wait confirmations)", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const settings: ContractSettings = {
                ...contractSettings,
                waitFor: { what: "confirmations", timeoutMS: 2000, confirmations: 5 },
                resubmitTransaction: []
            };
            await setMining("interval", 1000);
            // let error happen in submit
            let error: unknown;
            await withSettings(fpr, settings).setPrice("BTC", 1000, { gas: 1e6 })
                .catch(e => error = e);
            const blockNumber = await web3.eth.getBlockNumber();
            assert(error instanceof TransactionFailedError);
            assert.include(error.message, "price not initialized");
            const cause = error.errorCause;
            assert(cause instanceof TransactionSubmitRevertedError);
            const transaction = await web3.eth.getTransaction(cause.transactionHash);
            assert.isAtLeast(blockNumber, transaction.blockNumber! + 2);
        });

        it("should wait for two blocks extra after error happens and then reorg", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await FakePriceReader.new(accounts[0]);
            const settings: ContractSettings = {
                ...contractSettings,
                waitFor: { what: "nonceIncrease", pollMS: 500, timeoutMS: 10000, extra: { blocks: 2, timeMS: 5000 } },
                resubmitTransaction: []
            };
            await setMining("interval", 2000);
            // simulate network reorg with snapshot/revert
            const snapshotId = await network.provider.send("evm_snapshot", []);
            setTimeout(() => { void network.provider.send("evm_revert", [snapshotId]); }, 2500);
            // let error happen in submit
            let error: unknown;
            await withSettings(fpr, settings).setPrice("BTC", 1000, { gas: 1e6 })
                .catch(e => error = e);
            // check
            assert(error instanceof TransactionFailedError);
            const cause = error.errorCause;
            assert(cause instanceof TransactionSubmitRevertedError);
            const transaction = await web3.eth.getTransaction(cause.transactionHash).catch(e => null);
            assert.isNull(transaction);
        });
    });

    describe("resubmit test", () => {
        afterEach(async () => {
            await setMining("auto");
        });

        it("resubmit should work", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const settings: Partial<ContractSettings> = {
                resubmitTransaction: [
                    { afterMS: 1000, priceFactor: 2 },
                    { afterMS: 3000, priceFactor: 3 },
                ],
            };
            const fpr = await withSettings(FakePriceReader, settings).new(accounts[0]);
            // warm up storage
            const res1 = await fpr.setDecimals("XRP", 10);
            // console.log(res1.receipt.effectiveGasPrice);
            // try 1
            const res2 = await fpr.setDecimals("XRP", 11);
            // console.log(res2.receipt.effectiveGasPrice);
            // set to timed mining
            await setMining("interval", 2000);
            // test send
            const res3 = await fpr.setDecimals("XRP", 12);
            // console.log(res3.receipt.effectiveGasPrice);
            assert.isAbove(res3.receipt.effectiveGasPrice, 1.5 * res2.receipt.effectiveGasPrice);
            assert.isBelow(res3.receipt.effectiveGasPrice, 2.5 * res2.receipt.effectiveGasPrice);
            // check result
            const { 2: dec } = await fpr.getPrice("XRP");
            assert.equal(Number(dec), 12);
        });

        it("resubmit should work - explicit gas price and initial factor", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const settings1: Partial<ContractSettings> = {
                resubmitTransaction: [
                    { afterMS: 1000, priceFactor: 2 },
                    { afterMS: 3000, priceFactor: 3 },
                ],
            };
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            // try 1
            const res1 = await fpr.setDecimals("XRP", 10, { gasPrice: 1.5e9 });
            // console.log(res1.receipt.effectiveGasPrice);
            assert.equal(res1.receipt.effectiveGasPrice, 1.5e9);
            // try 2
            const settings2: Partial<ContractSettings> = {
                resubmitTransaction: [
                    { afterMS: 0, priceFactor: 1.5 },
                    { afterMS: 1000, priceFactor: 2 },
                    { afterMS: 3000, priceFactor: 3 },
                ],
            };
            const res2 = await withSettings(fpr, settings2).setDecimals("XRP", 11, { gasPrice: 1.5e9 });
            // console.log(res2.receipt.effectiveGasPrice);
            assert.equal(res2.receipt.effectiveGasPrice, 2.25e9);
            // set to timed mining
            await setMining("interval", 2000);
            // try 3
            const res3 = await withSettings(fpr, settings2).setDecimals("XRP", 12, { gasPrice: 1.5e9 });
            assert.equal(res3.receipt.effectiveGasPrice, 3.0e9);
            // try 4
            const settings3: Partial<ContractSettings> = {
                resubmitTransaction: [
                    { afterMS: 0, priceFactor: 1.5 },
                    { afterMS: 750, priceFactor: 2 },
                    { afterMS: 1500, priceFactor: 3 },
                ],
            };
            const res4 = await withSettings(fpr, settings3).setDecimals("XRP", 20, { gasPrice: 1.5e9 });
            // console.log(res4.receipt.effectiveGasPrice);
            assert.equal(res4.receipt.effectiveGasPrice, 4.5e9);
            // check result
            const { 2: dec } = await fpr.getPrice("XRP");
            assert.equal(Number(dec), 20);
        });
    });

    describe("memory lock tests", () => {
        afterEach(async () => {
            await setMining("auto");
        });

        it("should lock nonce", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const settings1: Partial<ContractSettings> = {
                resubmitTransaction: [
                    { afterMS: 1000, priceFactor: 2 },
                    { afterMS: 3000, priceFactor: 3 },
                ],
                addressLocks: new MemoryAddressLocks({ waitTimeoutMS: 3000 }),
            };
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            // set to timed mining
            await setMining("interval", 2000);
            await Promise.all([
                withSettings(fpr, settings1).setDecimals("XRP", 6, { gasPrice: 1.5e9 }),
                delayed(100, () => withSettings(fpr, settings1).setDecimals("BTC", 8, { gasPrice: 1.5e9 })),
            ]);
            // check result
            const { 2: dec1 } = await fpr.getPrice("XRP");
            assert.equal(Number(dec1), 6);
            const { 2: dec2 } = await fpr.getPrice("BTC");
            assert.equal(Number(dec2), 8);
        });

        it("wait for lock should timeout", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const settings1: Partial<ContractSettings> = {
                resubmitTransaction: [
                    { afterMS: 1000, priceFactor: 2 },
                    { afterMS: 3000, priceFactor: 3 },
                ],
                addressLocks: new MemoryAddressLocks({ waitTimeoutMS: 3000 }),
            };
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            // set to timed mining
            await setMining("interval", 2000);
            const results = await Promise.allSettled([
                withSettings(fpr, settings1).setDecimals("XRP", 6, { gasPrice: 1.5e9 }),
                delayed(100, () => withSettings(fpr, settings1).setDecimals("BTC", 8, { gasPrice: 1.6e9 })),
                delayed(200, () => withSettings(fpr, settings1).setDecimals("DOGE", 5, { gasPrice: 1.7e9 })),
            ]);
            assert(results[0].status === "fulfilled", "first submit should succeed");
            assert(results.filter((r) => r.status === "fulfilled").length === 2, "exactly 2 submits should succeed");
            const failed = results.find((r) => r.status === "rejected");
            assert(
                failed?.status === "rejected" && failed.reason.message.includes("Timeout waiting to obtain address nonce lock"),
                `expected error 'Timeout waiting to obtain address nonce lock', got '${(failed as any).reason?.message || "No exception"}'`
            );
        });
    });

    describe("filesystem lock tests", () => {
        afterEach(async () => {
            await setMining("auto");
        });

        const settings1: Partial<ContractSettings> = {
            resubmitTransaction: [
                { afterMS: 1000, priceFactor: 2 },
                { afterMS: 3000, priceFactor: 3 },
            ],
            addressLocks: new FilesystemAddressLocks({
                waitTimeoutMS: 3000,
                lockExpirationMS: 60_000,
                lockDir: TEST_LOCK_DIR,
            }),
        };

        it("simple test (filesystem lock)", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            await withSettings(fpr, settings1).setDecimals("XRP", 6, { gasPrice: 1.5e9 });
            await withSettings(fpr, settings1).setDecimals("BTC", 8, { gasPrice: 1.5e9 });
            // check result
            const { 2: dec1 } = await fpr.getPrice("XRP");
            assert.equal(Number(dec1), 6);
            const { 2: dec2 } = await fpr.getPrice("BTC");
            assert.equal(Number(dec2), 8);
        });

        it("should lock nonce (filesystem)", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            // set to timed mining
            await setMining("interval", 2000);
            await Promise.all([
                withSettings(fpr, settings1).setDecimals("XRP", 6, { gasPrice: 1.5e9 }),
                delayed(100, () => withSettings(fpr, settings1).setDecimals("BTC", 8, { gasPrice: 1.5e9 })),
            ]);
            // check result
            const { 2: dec1 } = await fpr.getPrice("XRP");
            assert.equal(Number(dec1), 6);
            const { 2: dec2 } = await fpr.getPrice("BTC");
            assert.equal(Number(dec2), 8);
        });

        it("wait for lock should timeout (filesystem)", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            // set to timed mining
            await setMining("interval", 2000);
            const results = await Promise.allSettled([
                withSettings(fpr, settings1).setDecimals("XRP", 6, { gasPrice: 1.5e9 }),
                delayed(100, () => withSettings(fpr, settings1).setDecimals("BTC", 8, { gasPrice: 1.6e9 })),
                delayed(200, () => withSettings(fpr, settings1).setDecimals("DOGE", 5, { gasPrice: 1.7e9 })),
            ]);
            assert(results[0].status === "fulfilled", "first submit should succeed");
            assert(results.filter((r) => r.status === "fulfilled").length === 2, "exactly 2 submits should succeed");
            const failed = results.find((r) => r.status === "rejected");
            assert(
                failed?.status === "rejected" && failed.reason.message.includes("Timeout waiting to obtain address nonce lock"),
                `expected error 'Timeout waiting to obtain address nonce lock', got '${(failed as any).reason?.message || "No exception"}'`
            );
        });

        it("should expire lock (filesystem)", async () => {
            const addressLocks = new FilesystemAddressLocks({
                waitTimeoutMS: 3000,
                lockExpirationMS: 2_000,
                lockDir: TEST_LOCK_DIR,
            });
            let count = 0;
            async function testLock(waitMS: number) {
                const lock = await addressLocks.lock(accounts[0]);
                await sleep(waitMS);
                ++count;
                await addressLocks.release(lock);
            }
            await Promise.all([
                testLock(5000),
                delayed(1500, () => testLock(1000)),
            ]);
            assert.equal(count, 2);
        });

        it("should create and cleanup lock dir (filesystem)", async () => {
            const addressLocks = new FilesystemAddressLocks({
                waitTimeoutMS: 3000,
                lockExpirationMS: 2_000,
                lockDir: TEST_LOCK_DIR,
            });
            fs.rmSync(TEST_LOCK_DIR, { recursive: true, force: true });
            // create a lockfile
            await addressLocks.lock(accounts[0]);
            // create a fake lockfile
            const fakeLockfile = path.resolve(TEST_LOCK_DIR, `${accounts[1]}.lock`);
            fs.writeFileSync(fakeLockfile, "invalid-lock");
            const files1 = fs.readdirSync(TEST_LOCK_DIR);
            assert.equal(files1.length, 2);
            FilesystemAddressLocks.cleanup();
            const files2 = fs.readdirSync(TEST_LOCK_DIR);
            assert.equal(files2.length, 1);
            fs.rmSync(fakeLockfile);
        });
    });

    describe.skip("Coston nonce wait tests", () => {
        const costonFinalizationSettings: Partial<ContractSettings> = {
            waitFor: { what: "nonceIncrease", pollMS: 500, timeoutMS: 30_000, extra: { blocks: 2, timeMS: 10_000 } },
            addressLocks: new FilesystemAddressLocks({
                lockDir: TEST_LOCK_DIR,
                waitTimeoutMS: 120_000,
                lockExpirationMS: 300_000,
            }),
            resubmitTransaction: [
                { afterMS: 30_000, priceFactor: 1.2 },
                { afterMS: 60_000, priceFactor: 2.0 },
            ],
        };

        it("fast serial transactions should work (with new)", async () => {
            const FakePriceReader = withSettings(artifacts.require("FakePriceReader"), costonFinalizationSettings);
            const fprs: FakePriceReaderInstance[] = [];
            for (let i = 0; i < 5; i++) {
                console.log("nonce before new", await web3.eth.getTransactionCount(accounts[0]));
                fprs.push(await FakePriceReader.new(accounts[0]));
                console.log("nonce after new", await web3.eth.getTransactionCount(accounts[0]), "address:", fprs[i].address);
                await fprs[i].setDecimals("XRP", 5);
                console.log("nonce after setDecimals", await web3.eth.getTransactionCount(accounts[0]));
            }
            for (let i = 0; i < 30; i++) {
                const fpr = fprs[i % fprs.length];
                const price = Math.floor(1e5 * (Math.random() + 0.5));
                await fpr.setPrice("XRP", price);
            }
        });

        it("fast serial transactions should work", async () => {
            const fprAddresses = ["0x35c1419Da7cf0Ff885B8Ef8EA9242FEF6800c99b", "0xE55aA921A1001f0a19241264a50063683D2e1179", "0xf89AA2f1397e9A0622c8Fc99aB1947E28b5EF876",
                "0x0EBCa695959e5f138Af772FAa44ce1A9C7aEd921", "0x8BFFF31B1757da579Bb5B118489568526F7fb6D4"];
            const FakePriceReader = withSettings(artifacts.require("FakePriceReader"), costonFinalizationSettings);
            const fprs: FakePriceReaderInstance[] = [];
            for (const addr of fprAddresses) {
                fprs.push(await FakePriceReader.at(addr));
            }
            for (let i = 0; i < 30; i++) {
                const fpr = fprs[i % fprs.length];
                const symbol = "ABC" + new Date().getTime() + i;
                console.log("nonce =", await web3.eth.getTransactionCount(accounts[0]), "fpr =", fpr.address);
                await fpr.setDecimals(symbol, 6);
            }
        });

        it("parallel transactions should work", async () => {
            const fprAddresses = ["0x35c1419Da7cf0Ff885B8Ef8EA9242FEF6800c99b", "0xE55aA921A1001f0a19241264a50063683D2e1179", "0xf89AA2f1397e9A0622c8Fc99aB1947E28b5EF876",
                "0x0EBCa695959e5f138Af772FAa44ce1A9C7aEd921", "0x8BFFF31B1757da579Bb5B118489568526F7fb6D4"];
            const FakePriceReader = withSettings(artifacts.require("FakePriceReader"), {
                ...costonFinalizationSettings,
                addressLocks: new FilesystemAddressLocks({
                    lockDir: TEST_LOCK_DIR,
                    waitTimeoutMS: 3600_000,
                    lockExpirationMS: 7200_000,
                })
            });
            const fprs: FakePriceReaderInstance[] = [];
            for (const addr of fprAddresses) {
                fprs.push(await FakePriceReader.at(addr));
            }
            const promises: Promise<unknown>[] = [];
            for (let i = 0; i < 100; i++) {
                const fpr = fprs[i % fprs.length];
                const symbol = "ABC" + new Date().getTime() + i;
                // console.log("nonce =", await web3.eth.getTransactionCount(accounts[0]), "fpr =", fpr.address);
                promises.push(fpr.setDecimals(symbol, 6));
            }
            await Promise.all(promises);
        });
    });

    async function setMining(type: "auto" | "manual" | "interval", timeMS: number = 1000) {
        await network.provider.send("evm_setAutomine", [type === "auto"]);
        await network.provider.send("evm_setIntervalMining", [type === "interval" ? timeMS : 0]);
    }

    async function delayed<T>(ms: number, func: () => Promise<T>) {
        await sleep(ms);
        return await func();
    }

    async function expectRevertWithCorrectStack(promise: Promise<any>, message: string) {
        const filename = path.basename(__filename);
        await promise.catch((e) => {
            const lines = ((e.stack as string) ?? "").split("\n");
            if (!lines.some((s) => s.includes(filename) && !s.includes("expectRevertWithCorrectStack"))) {
                console.error("INVALID STACK", e);
                assert(false, "Invalid stack");
            }
        });
        await expectRevert(promise, message);
    }
});
