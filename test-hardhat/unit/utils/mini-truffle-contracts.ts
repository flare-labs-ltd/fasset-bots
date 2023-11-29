import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { assert, expect } from "chai";
import { network } from "hardhat";
import { improveConsoleLog, preventReentrancy, requireNotNull, sleep } from "../../../src/utils/helpers";
import { CancelToken, CancelTokenRegistration } from "../../../src/utils/mini-truffle-contracts/cancelable-promises";
import { MiniTruffleContract, MiniTruffleContractInstance, withSettings } from "../../../src/utils/mini-truffle-contracts/contracts";
import { waitForFinalization, waitForNonceIncrease, waitForReceipt } from "../../../src/utils/mini-truffle-contracts/finalization";
import { ContractSettings, TransactionWaitFor } from "../../../src/utils/mini-truffle-contracts/types";
import { artifacts, contractSettings, web3 } from "../../../src/utils/web3";
import { captureStackTrace, fixErrorStack } from "../../../src/utils/mini-truffle-contracts/transaction-logging";
import path from "path";

describe("mini truffle and artifacts tests", async () => {
    let accounts: string[];

    before(async () => {
        improveConsoleLog();
        accounts = await web3.eth.getAccounts();
    });

    describe("artifacts", () => {
        it("require should work", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            expect((FakePriceReader as MiniTruffleContract)._contractJson?.sourceName === "contracts/mock/FakePriceReader.sol");
        });

        it("require with directory should work", async () => {
            const GovernanceSettings = artifacts.require("flattened/FlareSmartContracts.sol:GovernanceSettings" as "GovernanceSettings");
            expect((GovernanceSettings as MiniTruffleContract)._contractJson?.sourceName === "flattened/FlareSmartContracts.sol");
        });

        it("require with wrong directory should fail", async () => {
            expect(() => artifacts.require("flare-smart-contracts/FlareSmartContracts.sol:GovernanceSettings" as "GovernanceSettings")).to.throw(
                "Unknown artifact flare-smart-contracts/FlareSmartContracts.sol:GovernanceSettings"
            );
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
                preventReentrancy(() => time.advanceBlock()),
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
                preventReentrancy(() => time.advanceBlock()),
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
            await expectRevertWithCorrectStack(
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
            const waitNonce = waitForNonceIncrease(web3, accounts[0], nonce, 500, cancelToken);
            const receipt = await waitForReceipt(promiEvent, cancelToken);
            await waitNonce; // should work
            const { 2: decimals } = await fpr.getPrice("XRP");
            expect(Number(decimals)).to.equal(8);
        });
    });

    describe("contract linking", () => {
        it("linking should work", async () => {
            const CollateralTypes = artifacts.require("CollateralTypes");
            const collateralTypes = await CollateralTypes.new();
            const SettingsUpdater = artifacts.require("SettingsUpdater");
            // both link variants in typechain don't work
            expect(() => SettingsUpdater.link(CollateralTypes)).to.throw("Only supported variant is 'SettingsUpdater.link(instance)'");
            expect(() => SettingsUpdater.link("CollateralTypes", collateralTypes.address)).to.throw(
                "Only supported variant is 'SettingsUpdater.link(instance)'"
            );
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
            await expectRevertWithCorrectStack(SettingsUpdater.new(), "Contract SettingsUpdater must be linked before deploy");
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
                    testRegistration.unregister();
                    clearInterval(testTimer);
                });
                testCancelable.catch(); // prevent uncought promise rejection
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
            await expectRevertWithCorrectStack(promise1, "Promise cancelled");
            registration1!.unregister(); // should succeed
            expect(() => cancelToken.check()).to.throw("Promise cancelled");
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
            });
        });

        function rejectTimer() {
            return new Promise((resolve, reject) => {
                const parentStack = captureStackTrace();
                setTimeout(() => {
                    reject(fixErrorStack(new Error("Time passed"), parentStack));
                }, 300);
            });
        }

        function rejectTimerSimp() {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    reject(new Error("Time passed"));
                }, 300);
            });
        }

        it("test reject", async () => {
            await rejectTimer().catch((e) => {
                console.error("TIMER ERR", e);
                assert.include(e.stack, path.basename(__filename));
            });
        });

        it("test reject simp", async () => {
            try {
                await rejectTimerSimp().catch((e) => {
                    throw fixErrorStack(e, 1);
                });
            } catch (e: any) {
                console.error("TIMER ERR", e);
                assert.include(e.stack, path.basename(__filename));
            }
        });
    });

    describe("resubmit test", () => {
        async function setMining(type: "auto" | "manual" | "interval", timeMS: number = 1000) {
            await network.provider.send("evm_setAutomine", [type === "auto"]);
            await network.provider.send("evm_setIntervalMining", [type === "interval" ? timeMS : 0]);
        }

        afterEach(() => {
            setMining("auto");
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
            setMining("interval", 2000);
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
            setMining("interval", 2000);
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

        async function delayed<T>(ms: number, func: () => Promise<T>) {
            await sleep(ms);
            return await func();
        }

        it("should lock nonce", async () => {
            const FakePriceReader = artifacts.require("FakePriceReader");
            const settings1: Partial<ContractSettings> = {
                resubmitTransaction: [
                    { afterMS: 1000, priceFactor: 2 },
                    { afterMS: 3000, priceFactor: 3 },
                ],
                nonceLockTimeoutMS: 3000,
            };
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            // set to timed mining
            setMining("interval", 2000);
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
                nonceLockTimeoutMS: 3000,
            };
            const fpr = await withSettings(FakePriceReader, settings1).new(accounts[0]);
            // set to timed mining
            setMining("interval", 2000);
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
