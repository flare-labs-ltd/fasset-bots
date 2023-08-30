import { TestAssetBotContext, createTestAssetContext } from "../test-utils/create-test-asset-context";
import { createTestAgentBAndMakeAvailable, createTestAgentBotAndMakeAvailable, createTestMinter, disableMccTraceManager } from "../test-utils/helpers";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import { web3 } from "../../src/utils/web3";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { expectErrors, sleep, sumBN, systemTimestamp, toBIPS, toBN } from "../../src/utils/helpers";
import {
    InclusionIterable,
    currentRealTime,
    getEnv,
    mulDecimal,
    randomChoice,
    randomInt,
    randomNum,
    toWei,
    weightedRandomChoice,
} from "../test-utils/fuzzing-utils";
import { Challenger } from "../../src/actors/Challenger";
import { TestChainInfo, testChainInfo, testNativeChainInfo } from "../../test/test-utils/TestChainInfo";
import { assert } from "chai";
import { FuzzingRunner } from "./FuzzingRunner";
import { isPoolCollateral } from "../../src/state/CollateralIndexedList";
import { AgentBotDefaultSettings } from "../../src/fasset-bots/IAssetBotContext";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { time } from "@openzeppelin/test-helpers";
import { latestBlockTimestamp } from "../../src/utils/web3helpers";
import { FtsoMockInstance } from "../../typechain-truffle";
import { FuzzingAgentBot } from "./FuzzingAgentBot";
import { network } from "hardhat";
import { CollateralClass, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { EventFormatter } from "../test-utils/EventFormatter";
import { BotCliCommands } from "../../src/actors/AgentBotCliCommands";
import { MockIndexer } from "../../src/mock/MockIndexer";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { artifacts } from "../../src/utils/artifacts";
import { Liquidator } from "../../src/actors/Liquidator";
import { TimeKeeper } from "../../src/actors/TimeKeeper";
import { FuzzingNotifier } from "./FuzzingNotifier";
import { Notifier } from "../../src/utils/Notifier";
import { FuzzingTimeline } from "./FuzzingTimeline";
import { FuzzingStateComparator } from "./FuzzingStateComparator";
import { FuzzingState } from "./FuzzingState";

export type MiningMode = "auto" | "manual";

const StateConnector = artifacts.require("StateConnectorMock");

describe("Fuzzing tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let governance: string;
    let commonTrackedState: FuzzingState;
    let timeline: FuzzingTimeline;

    const startTimestamp = systemTimestamp();

    const CHAIN = getEnv("CHAIN", "string", "xrp");
    const LOOPS = getEnv("LOOPS", "number", 100);
    const AUTOMINE = getEnv("AUTOMINE", "boolean", true);
    const N_AGENTS = getEnv("N_AGENTS", "number", 4);
    const N_CUSTOMERS = getEnv("N_CUSTOMERS", "number", 6); // minters and redeemers
    const N_KEEPERS = getEnv("N_KEEPERS", "number", 1);
    const N_LIQUIDATORS = getEnv("N_LIQUIDATORS", "number", 1);
    const CUSTOMER_BALANCE = toWei(getEnv("CUSTOMER_BALANCE", "number", 10_000)); // initial underlying balance
    const AVOID_ERRORS = getEnv("AVOID_ERRORS", "boolean", true);
    const CHANGE_PRICE_AT = getEnv("CHANGE_PRICE_AT", "range", [3, 88]);
    const CHANGE_PRICE_FACTOR = getEnv("CHANGE_PRICE_FACTOR", "json", { asset: [10, 12], default: [1, 1] }) as { [key: string]: [number, number] };
    const ILLEGAL_PROB = getEnv("ILLEGAL_PROB", "number", 4); // likelihood of illegal operations (not normalized)

    const agentBots: FuzzingAgentBot[] = [];
    const customers: FuzzingCustomer[] = [];
    const keepers: SystemKeeper[] = [];
    const liquidators: Liquidator[] = [];
    let challenger: Challenger;
    let chainInfo: TestChainInfo;
    let chain: MockChain;
    let eventFormatter: EventFormatter;
    let runner: FuzzingRunner;
    let notifier: Notifier;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        governance = accounts[1];
        // create context
        chainInfo = testChainInfo[CHAIN as keyof typeof testChainInfo] ?? assert.fail(`Invalid chain ${CHAIN}`);
        context = await createTestAssetContext(governance, chainInfo);
        chain = context.blockchainIndexer.chain as MockChain;
        // create interceptor
        eventFormatter = new EventFormatter();
        notifier = new FuzzingNotifier(new Notifier(), eventFormatter);
        // state checker
        const lastBlock = await web3.eth.getBlockNumber();
        commonTrackedState = new FuzzingState(context, lastBlock, new MockChainWallet(chain));
        await commonTrackedState.initialize();
        // runner
        runner = new FuzzingRunner(context, AVOID_ERRORS, commonTrackedState, eventFormatter);
        // timeline
        timeline = new FuzzingTimeline(chain, runner);
    });

    it("f-asset fuzzing test", async () => {
        // create bots
        const orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: "recreate", dbName: "fasset-bots-test_fuzzing.db", type: "sqlite" }));
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const ownerAddress = accounts[firstAgentAddress + i];
            eventFormatter.addAddress("OWNER_ADDRESS_" + i, ownerAddress);
            const ownerUnderlyingAddress = "underlying_owner_agent_" + i;
            const options = createAgentOptions();
            const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, notifier, options);
            const botCliCommands = new BotCliCommands();
            botCliCommands.context = context;
            botCliCommands.ownerAddress = ownerAddress;
            const chainId = chainInfo.chainId;
            botCliCommands.botConfig = {
                rpcUrl: "",
                loopDelay: 0,
                chains: [
                    {
                        chainInfo: chainInfo,
                        wallet: new MockChainWallet(chain),
                        blockchainIndexerClient: new MockIndexer("", chainId, chain),
                        stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainInfo.chainId]: chain }, "auto"),
                        assetManager: "",
                    },
                ],
                nativeChainInfo: testNativeChainInfo,
                orm: orm,
                notifier: notifier,
                addressUpdater: "",
            };
            const fuzzingAgentBot = new FuzzingAgentBot(agentBot, runner, orm.em, ownerUnderlyingAddress, botCliCommands);
            agentBots.push(fuzzingAgentBot);
            eventFormatter.addAddress(`BOT_${i}`, fuzzingAgentBot.agentBot.agent.vaultAddress);
        }
        // create customers
        const firstCustomerAddress = firstAgentAddress + 3 * N_AGENTS;
        for (let i = 0; i < N_CUSTOMERS; i++) {
            const underlyingAddress = "underlying_customer_" + i;
            const customer = await FuzzingCustomer.createTest(runner, accounts[firstCustomerAddress + i], underlyingAddress, CUSTOMER_BALANCE);
            chain.mint(underlyingAddress, 1_000_000);
            customers.push(customer);
            eventFormatter.addAddress(`CUSTOMER_${i}`, customer.address);
        }
        // create system keepers
        const firstKeeperAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS;
        for (let i = 0; i < N_KEEPERS; i++) {
            const keeper = new SystemKeeper(runner, accounts[firstKeeperAddress + i], commonTrackedState);
            keepers.push(keeper);
            eventFormatter.addAddress(`KEEPER_${i}`, keeper.address);
        }
        // create liquidators
        const firstLiquidatorAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS;
        for (let i = 0; i < N_LIQUIDATORS; i++) {
            const liquidator = new Liquidator(runner, accounts[firstLiquidatorAddress + i], commonTrackedState);
            liquidators.push(liquidator);
            // await context.fAsset.mint(accounts[1], 100);
            eventFormatter.addAddress(`LIQUIDATOR_${i}`, liquidator.address);
            await transferFassetsToLiquidator(liquidator.address);
        }
        // create challenger
        const challengerAddress = accounts[firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + N_LIQUIDATORS];
        challenger = new Challenger(runner, challengerAddress, commonTrackedState, await context.blockchainIndexer.chain.getBlockHeight());
        eventFormatter.addAddress(`CHALLENGER`, challenger.address);
        // create time keeper
        const timeKeeperAddress = accounts[firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + N_LIQUIDATORS + 1];
        const timeKeeper = new TimeKeeper(timeKeeperAddress, context, 60000);
        timeKeeper.run();
        // init some state
        await refreshAvailableAgents();
        // actions
        const actions: Array<[() => Promise<void>, number]> = [
            [testMint, 50],
            [testRedeem, 50],
            [testSelfMint, 10],
            [testSelfClose, 10],
            [testUnderlyingWithdrawal, 40],
            [refreshAvailableAgents, 6],
            [testIllegalTransaction, ILLEGAL_PROB],
            [testDoublePayment, ILLEGAL_PROB],
        ];
        const timedActions: Array<[(index: number) => Promise<void>, InclusionIterable<number> | null]> = [[testChangePrices, CHANGE_PRICE_AT]];
        // switch underlying chain to timed mining
        chain.automine = false;
        chain.finalizationBlocks = chainInfo.finalizationBlocks;
        // make sure here are enough blocks in chain for block height proof to succeed
        while (chain.blockHeight() <= chain.finalizationBlocks) {
            chain.mine();
        }
        if (!AUTOMINE) {
            await setMiningMode("manual", 1000);
        }
        // run tracked state
        await commonTrackedState.readUnhandledEvents();
        // perform actions
        for (let loop = 1; loop <= LOOPS; loop++) {
            // choose random action
            const action = weightedRandomChoice(actions);
            try {
                // run action
                await action();
            } catch (e) {
                expectErrors(e, []);
            }
            // run actions, triggered at certain loop numbers
            for (const [timedAction, runAt] of timedActions) {
                // await interceptor.allHandled();
                if (!runAt?.includes(loop)) continue;
                try {
                    const index = runAt.indexOf(loop);
                    await timedAction(index);
                } catch (e) {
                    expectErrors(e, []);
                }
            }
            // run actors
            try {
                // execute step for every bot
                for (const bot of agentBots) {
                    await bot.agentBot.runStep(bot.rootEm);
                }
                // execute step for liquidator
                for (const liquidator of liquidators) {
                    await liquidator.runStep();
                }
                // execute step for every keeper
                for (const keeper of keepers) {
                    await keeper.runStep();
                }
                // execute step for challenger
                await challenger.runStep();
                // run tracked state
                await commonTrackedState.readUnhandledEvents();
            } catch (e) {
                expectErrors(e, []);
            }
            // fail immediately on unexpected errors from threads
            if (runner.uncaughtErrors.length > 0) {
                throw runner.uncaughtErrors[0];
            }
            // occasionally skip some time
            if (loop % 10 === 0) {
                await checkInvariants(false); // state change may happen during check, so we don't have any failure here
                runner.comment(`-----  LOOP ${loop}  ${await timeInfo()}  -----`);
                await timeline.skipTime(100);
                await commonTrackedState.readUnhandledEvents();
            }
        }
        timeKeeper.clear();
        // wait for all threads to finish
        runner.comment(`Remaining threads: ${runner.runningThreads}`);
        while (runner.runningThreads > 0) {
            await sleep(200);
            await timeline.skipTime(100);
            runner.comment(`-----  WAITING  ${await timeInfo()}  -----`);
        }
        // fail immediately on unexpected errors from threads
        if (runner.uncaughtErrors.length > 0) {
            throw runner.uncaughtErrors[0];
        }
        runner.comment(`Remaining threads: ${runner.runningThreads}`);
        await checkInvariants(true); // all events are flushed, state must match
        // assert.isTrue(fuzzingState.failedExpectations.length === 0, "fuzzing state has expectation failures");
    });

    function createAgentOptions(): AgentBotDefaultSettings {
        const vaultCollateral = randomChoice(context.collaterals.filter(isVaultCollateral));
        const poolCollateral = context.collaterals.filter(isPoolCollateral)[0];
        const mintingVaultCollateralRatioBIPS = mulDecimal(toBN(vaultCollateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        const mintingPoolCollateralRatioBIPS = mulDecimal(toBN(poolCollateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        return {
            vaultCollateralToken: vaultCollateral.token,
            feeBIPS: toBIPS("5%"),
            poolFeeShareBIPS: toBIPS("40%"),
            mintingVaultCollateralRatioBIPS: mintingVaultCollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: mintingPoolCollateralRatioBIPS,
            poolExitCollateralRatioBIPS: mulDecimal(mintingPoolCollateralRatioBIPS, randomNum(1, 1.25)),
            buyFAssetByAgentFactorBIPS: toBIPS(0.9),
            poolTopupCollateralRatioBIPS: toBN(randomInt(Number(poolCollateral.minCollateralRatioBIPS), Number(mintingPoolCollateralRatioBIPS))),
            poolTopupTokenPriceFactorBIPS: toBIPS(0.8),
        };
    }

    async function timeInfo() {
        return (
            `block=${await time.latestBlock()} timestamp=${(await latestBlockTimestamp()) - startTimestamp}  ` +
            `underlyingBlock=${chain.blockHeight()} underlyingTimestamp=${chain.lastBlockTimestamp() - startTimestamp}  ` +
            `skew=${(await latestBlockTimestamp()) - chain.lastBlockTimestamp()}  ` +
            `realTime=${(currentRealTime() - startTimestamp).toFixed(3)}`
        );
    }

    async function refreshAvailableAgents() {
        await runner.refreshAvailableAgentBots();
    }

    async function testMint() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.minting(scope));
    }

    async function testSelfMint() {
        const agentBot = randomChoice(agentBots);
        runner.startThread((scope) => agentBot.selfMint(scope, chain));
    }

    async function testRedeem() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.redemption(scope));
    }

    async function testSelfClose() {
        const agentBot = randomChoice(agentBots);
        runner.startThread((scope) => agentBot.selfClose(scope));
    }

    async function testUnderlyingWithdrawal() {
        const agentBot = randomChoice(agentBots);
        runner.startThread(() => agentBot.announcedUnderlyingWithdrawal());
    }

    async function testIllegalTransaction() {
        const agentBot = randomChoice(agentBots);
        runner.startThread(() => agentBot.makeIllegalTransaction());
    }

    async function testDoublePayment() {
        const agentBot = randomChoice(agentBots);
        runner.startThread(() => agentBot.makeDoublePayment());
    }

    async function testChangePrices() {
        for (const [symbol, ftso] of Object.entries(context.ftsos)) {
            const [minFactor, maxFactor] = CHANGE_PRICE_FACTOR[symbol] ?? CHANGE_PRICE_FACTOR["default"] ?? [0.9, 1.1];
            await _changePriceOnFtso(ftso, randomNum(minFactor, maxFactor));
        }
        await context.ftsoManager.mockFinalizePriceEpoch();
    }

    async function _changePriceOnFtso(ftso: FtsoMockInstance, factor: number) {
        const { 0: price } = await ftso.getCurrentPrice();
        const newPrice = mulDecimal(price, factor);
        await ftso.setCurrentPrice(newPrice, 0);
        await ftso.setCurrentPriceFromTrustedProviders(newPrice, 0);
    }

    async function setMiningMode(miningMode: MiningMode, interval: number = 0) {
        if (miningMode === "manual") {
            await network.provider.send("evm_setAutomine", [false]);
            await network.provider.send("evm_setIntervalMining", [interval]);
        } else {
            await network.provider.send("evm_setIntervalMining", [0]);
            await network.provider.send("evm_setAutomine", [true]);
        }
    }

    function isVaultCollateral(collateral: CollateralType) {
        return Number(collateral.collateralClass) === CollateralClass.VAULT && Number(collateral.validUntil) === 0;
    }

    async function transferFassetsToLiquidator(liquidatorAddress: string): Promise<void> {
        const agentB = await createTestAgentBAndMakeAvailable(context, accounts[1000]);
        eventFormatter.addAddress(`MINTER_BOT`, agentB.vaultAddress);
        const minter = await createTestMinter(context, accounts[999], chain);
        const lots = 3;
        const crt = await minter.reserveCollateral(agentB.vaultAddress, lots);
        const txHash0 = await minter.performMintingPayment(crt);
        chain.mine(chain.finalizationBlocks + 1);
        const minted = await minter.executeMinting(crt, txHash0);
        // liquidator "buys" f-assets
        await context.fAsset.transfer(liquidatorAddress, minted.mintedAmountUBA, { from: minter.address });
        const exitAllowedAt = await agentB.announceExitAvailable();
        await time.increaseTo(exitAllowedAt);
        await agentB.exitAvailable();
    }

    async function checkInvariants(failOnProblems: boolean) {
        console.log("****************** CHECK INVARIANTS - START ******************");
        const checker = new FuzzingStateComparator();
        // total supply
        const fAssetSupply = await context.fAsset.totalSupply();
        checker.checkEquality("fAsset supply", fAssetSupply, commonTrackedState.fAssetSupply, true);
        // // total balances
        // const totalBalances = commonTrackedState.fAssetBalance.total();
        // checker.checkEquality('fAsset supply / total balances', fAssetSupply, totalBalances);
        // total minted value by all agents
        const totalMintedUBA = sumBN(commonTrackedState.agents.values(), (agent) => agent.mintedUBA);
        checker.checkEquality("fAsset supply/total minted by agents", fAssetSupply, totalMintedUBA, true);
        // settings
        const actualSettings = await context.assetManager.getSettings();
        for (const [key, value] of Object.entries(actualSettings)) {
            if (/^\d+$/.test(key)) continue; // all properties are both named and with index
            if (["assetManagerController"].includes(key)) continue; // special properties, not changed in normal way
            checker.checkEquality(`settings.${key}`, value, (commonTrackedState.settings as any)[key]);
        }
        // check agents' state
        for (const agent of commonTrackedState.agents.values()) {
            await agent.checkInvariants(checker, eventFormatter.formatAddress(agent.vaultAddress));
        }
        // optionally fail on differences
        if (failOnProblems && checker.problems > 0) {
            assert.fail("Tracked and actual state different");
        }
        console.log("****************** CHECK INVARIANTS - END ******************");
    }
});
