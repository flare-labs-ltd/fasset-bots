import { TestAssetBotContext, createTestAssetContext, setLotSizeAmg } from "../test-utils/create-test-asset-context";
import { createTestAgentBotAndMakeAvailable, disableMccTraceManager } from "../test-utils/helpers";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import { web3 } from "../../src/utils/web3";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { expectErrors, sleep, systemTimestamp, toBIPS, toBN } from "../../src/utils/helpers";
import { InclusionIterable, coinFlip, currentRealTime, formatBN, getEnv, mulDecimal, randomChoice, randomInt, randomNum, toWei, weightedRandomChoice } from "../test-utils/fuzzing-utils";
import { Challenger } from "../../src/actors/Challenger";
import { TestChainInfo, testChainInfo } from "../../test/test-utils/TestChainInfo";
import { assert } from "chai";
import { FuzzingRunner } from "./FuzzingRunner";
import { TrackedState } from "../../src/state/TrackedState";
import { isPoolCollateral } from "../../src/state/CollateralIndexedList";
import { AgentBotDefaultSettings } from "../../src/fasset-bots/IAssetBotContext";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { FuzzingPoolTokenHolder } from "./FuzzingPoolTokenHolder";
import { time } from "@openzeppelin/test-helpers";
import { latestBlockTimestamp } from "../../src/utils/web3helpers";
import { proveAndUpdateUnderlyingBlock } from "../../src/utils/fasset-helpers";
import { FtsoMockInstance } from "../../typechain-truffle";
import { FuzzingAgentBot } from "./FuzzingAgentBot";
import { network } from "hardhat";
import { CollateralClass, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { EventFormatter } from "../test-utils/EventFormatter";
import { BotCliCommands } from "../../src/cli/BotCliCommands";
import { MockIndexer } from "../../src/mock/MockIndexer";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { artifacts } from "../../src/utils/artifacts";
import { Liquidator } from "../../src/actors/Liquidator";
import { TimeKeeper } from "../../src/actors/TimeKeeper";
import { FuzzingNotifier } from "./FuzzingNotifier";
import { Notifier } from "../../src/utils/Notifier";

export type MiningMode = 'auto' | 'manual'

const StateConnector = artifacts.require('StateConnectorMock');

describe("Fuzzing tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let governance: string;
    let commonTrackedState: TrackedState;

    const startTimestamp = systemTimestamp();

    const CHAIN = getEnv('CHAIN', 'string', 'xrp');
    const LOOPS = getEnv('LOOPS', 'number', 100);
    const AUTOMINE = getEnv('AUTOMINE', 'boolean', true);
    const N_AGENTS = getEnv('N_AGENTS', 'number', 10);
    const N_CUSTOMERS = getEnv('N_CUSTOMERS', 'number', 10);     // minters and redeemers
    const N_KEEPERS = getEnv('N_KEEPERS', 'number', 1);
    const N_LIQUIDATORS = getEnv('N_LIQUIDATORS', 'number', 1);
    const N_POOL_TOKEN_HOLDERS = getEnv('N_POOL_TOKEN_HOLDERS', 'number', 20);
    const CUSTOMER_BALANCE = toWei(getEnv('CUSTOMER_BALANCE', 'number', 10_000));  // initial underlying balance
    const AVOID_ERRORS = getEnv('AVOID_ERRORS', 'boolean', true);
    const CHANGE_LOT_SIZE_AT = getEnv('CHANGE_LOT_SIZE_AT', 'range', null);
    const CHANGE_LOT_SIZE_FACTOR = getEnv('CHANGE_LOT_SIZE_FACTOR', 'number[]', []);
    const CHANGE_PRICE_AT = getEnv('CHANGE_PRICE_AT', 'range', null);
    const CHANGE_PRICE_FACTOR = getEnv('CHANGE_PRICE_FACTOR', 'json', null) as { [key: string]: [number, number] };
    const ILLEGAL_PROB = getEnv('ILLEGAL_PROB', 'number', 2);     // likelihood of illegal operations (not normalized)

    // let timeline: FuzzingTimeline;
    const agentBots: FuzzingAgentBot[] = [];
    const customers: FuzzingCustomer[] = [];
    const keepers: SystemKeeper[] = [];
    const liquidators: Liquidator[] = [];
    const poolTokenHolders: FuzzingPoolTokenHolder[] = [];
    let challenger: Challenger;
    let chainInfo: TestChainInfo;
    let chain: MockChain;
    let eventFormatter: EventFormatter;
    // let interceptor: TruffleTransactionInterceptor;
    // let truffleEvents: InterceptorEvmEvents;
    // let eventQueue: EventExecutionQueue;
    // let chainEvents: UnderlyingChainEvents;
    // let trackedState: TrackedState;
    // let logger: LogFile;
    let runner: FuzzingRunner;
    // let checkedInvariants = false;
    let notifier: Notifier;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        governance = accounts[1];
        // create context
        chainInfo = testChainInfo[CHAIN as keyof typeof testChainInfo] ?? assert.fail(`Invalid chain ${CHAIN}`);
        context = await createTestAssetContext(governance, chainInfo)
        chain = context.chain as MockChain;
        // create interceptor
        eventFormatter = new EventFormatter();// eventDecoder = new Web3EventDecoder({});
        notifier = new FuzzingNotifier(new Notifier, eventFormatter);
        // interceptor = new TruffleTransactionInterceptor(eventDecoder, accounts[0]);
        // interceptor.captureEvents({
        //     assetManager: context.assetManager,
        //     assetManagerController: context.assetManagerController,
        //     fAsset: context.fAsset,
        //     wnat: context.wNat,
        //     ftsoManager: context.ftsoManager,
        // });
        // for (const [key, token] of Object.entries(context.stablecoins)) {
        //     interceptor.captureEventsFrom(key, token, "ERC20");
        // }
        // uniform event handlers
        // eventQueue = new EventExecutionQueue();
        // context.chainEvents.executionQueue = eventQueue;
        // truffleEvents = new InterceptorEvmEvents(interceptor, eventQueue);
        // chainEvents = context.chainEvents;
        // timeline = new FuzzingTimeline(chain, eventQueue);
        // state checker
        const lastBlock = await web3.eth.getBlockNumber();
        commonTrackedState = new TrackedState(context, lastBlock);
        await commonTrackedState.initialize();
        // runner
        runner = new FuzzingRunner(context, AVOID_ERRORS, commonTrackedState, eventFormatter);
        // logging
        // logger = new LogFile("test_logs/fasset-fuzzing.log");
        // interceptor.logger = logger;
        // chain.logger = logger;
        // timeline.logger = logger;
        // (context.stateConnectorClient as MockStateConnectorClient).logger = logger;
        // fuzzingState.logger = logger;
    });

    after(async () => {
        // fuzzingState.logAllAgentActions();
        // if (!checkedInvariants) {
        //     await fuzzingState.checkInvariants(false).catch(e => {});
        // }
        // fuzzingState.logAllAgentSummaries();
        // fuzzingState.logAllPoolSummaries();
        // fuzzingState.logExpectationFailures();
        // interceptor.logGasUsage();
        // logger.close();
    });

    it("f-asset fuzzing test", async () => {
        // create bots
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const ownerAddress = accounts[firstAgentAddress + i];
            eventFormatter.addAddress(`OWNER_ADDRESS`, ownerAddress);
            const ownerUnderlyingAddress = "underlying_owner_agent_" + i;
            const orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate', dbName: 'fasset-bots-test_' + i + '.db' }));
            const options = createAgentOptions();
            const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, notifier, options);
            const botCliCommands = new BotCliCommands();
            botCliCommands.context = context;
            botCliCommands.ownerAddress = ownerAddress;
            const chainId = chainInfo.chainId;
            botCliCommands.botConfig = {
                rpcUrl: "",
                loopDelay: 0,
                stateConnector: new MockStateConnectorClient(await StateConnector.new(), "auto"),
                chains: [{
                    chainInfo: chainInfo,
                    chain: chain,
                    wallet: new MockChainWallet(chain),
                    blockChainIndexerClient: new MockIndexer("", chainId, chain),
                    assetManager: "",
                }],
                nativeChainInfo: {
                    finalizationBlocks: 0,
                    readLogsChunkSize: 0,
                },
                orm: orm,
                notifier: notifier,
                addressUpdater: ""
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
            const lastBlock = await web3.eth.getBlockNumber();
            const trackedState = new TrackedState(context, lastBlock);
            await trackedState.initialize();
            const keeper = new SystemKeeper(runner, accounts[firstKeeperAddress + i], trackedState);
            keepers.push(keeper);
            eventFormatter.addAddress(`KEEPER_${i}`, keeper.address);
        }
        // create liquidators
        const firstLiquidatorAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS;
        for (let i = 0; i < N_LIQUIDATORS; i++) {
            const lastBlock = await web3.eth.getBlockNumber();
            const trackedState = new TrackedState(context, lastBlock);
            await trackedState.initialize();
            const liquidator = new Liquidator(runner, accounts[firstLiquidatorAddress + i], trackedState);
            liquidators.push(liquidator);
            eventFormatter.addAddress(`LIQUIDATOR_${i}`, liquidator.address);
        }
        // create challenger
        const lastBlock = await web3.eth.getBlockNumber();
        const trackedState = new TrackedState(context, lastBlock);
        await trackedState.initialize();
        const challengerAddress = accounts[firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + N_LIQUIDATORS];
        challenger = new Challenger(runner, challengerAddress, trackedState, await context.chain.getBlockHeight());
        eventFormatter.addAddress(`CHALLENGER`, challenger.address);
        // create pool token holders
        const firstPoolTokenHolderAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + N_LIQUIDATORS + 1;
        for (let i = 0; i < N_POOL_TOKEN_HOLDERS; i++) {
            const lpholder = new FuzzingPoolTokenHolder(runner, accounts[firstPoolTokenHolderAddress + i]);
            poolTokenHolders.push(lpholder);
            eventFormatter.addAddress(`POOL_TOKEN_HOLDER_${i}`, lpholder.address);
        }
        // create time keeper
        const timeKeeper = new TimeKeeper(context);
        timeKeeper.run();
        // await interceptor.allHandled();
        // init some state
        await refreshAvailableAgents();
        // actions
        const actions: Array<[() => Promise<void>, number]> = [
            [testMint, 10],
            [testRedeem, 10],
            [testSelfMint, 10],
            [testSelfClose, 10],
            [testConvertDustToTicket, 10],
            [testUnderlyingWithdrawal, 5],
            [refreshAvailableAgents, 1],
            [updateUnderlyingBlock, 10],
            [testEnterPool, 10],
            [testExitPool, 10],
            [testIllegalTransaction, ILLEGAL_PROB],
            [testDoublePayment, ILLEGAL_PROB],
        ];
        const timedActions: Array<[(index: number) => Promise<void>, InclusionIterable<number> | null]> = [
            [testChangeLotSize, CHANGE_LOT_SIZE_AT],
            [testChangePrices, CHANGE_PRICE_AT],
        ];
        // switch underlying chain to timed mining
        chain.automine = false;
        chain.finalizationBlocks = chainInfo.finalizationBlocks;
        // make sure here are enough blocks in chain for block height proof to succeed
        while (chain.blockHeight() <= chain.finalizationBlocks) chain.mine();
        if (!AUTOMINE) {
            await setMiningMode('manual', 1000);
        }
        // perform actions
        for (let loop = 1; loop <= LOOPS; loop++) {
            // run random action
            const action = weightedRandomChoice(actions);
            try {
                await commonTrackedState.readUnhandledEvents();
                await action();
                for (const bot of agentBots) {
                    await bot.agentBot.runStep(bot.rootEm);
                }
                for (const keeper of keepers) {
                    await keeper.runStep();
                }
                // runner.comment(`${runner.eventFormatter.formatAddress(challenger.address)}`);
                await challenger.runStep();
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
                    // interceptor.logUnexpectedError(e, '!!! JS ERROR');
                    expectErrors(e, []);
                }
                // await interceptor.allHandled();
            }
            // fail immediately on unexpected errors from threads
            if (runner.uncaughtErrors.length > 0) {
                throw runner.uncaughtErrors[0];
            }
            // occassionally skip some time
            if (loop % 10 === 0) {
                // run all queued event handlers
                // eventQueue.runAll();
                // await fuzzingState.checkInvariants(false);     // state change may happen during check, so we don't wany failure here
                runner.comment(`-----  LOOP ${loop}  ${await timeInfo()}  -----`);
                // await timeline.skipTime(100);
                // await timeline.executeTriggers();
                // await interceptor.allHandled();
            }
        }
        timeKeeper.clear();
        // wait for all threads to finish
        runner.comment(`Remaining threads: ${runner.runningThreads}`);
        while (runner.runningThreads > 0) {
            await sleep(200);
            //     await timeline.skipTime(100);
            runner.comment(`-----  WAITING  ${await timeInfo()}  -----`);
            //     await timeline.executeTriggers();
            // await interceptor.allHandled();
            //     while (eventQueue.length > 0) {
            //         eventQueue.runAll();
            //         await interceptor.allHandled();
            //     }
        }
        // fail immediately on unexpected errors from threads
        if (runner.uncaughtErrors.length > 0) {
            throw runner.uncaughtErrors[0];
        }
        runner.comment(`Remaining threads: ${runner.runningThreads}`);
        // checkedInvariants = true;
        // await fuzzingState.checkInvariants(true);  // all events are flushed, state must match
        // assert.isTrue(fuzzingState.failedExpectations.length === 0, "fuzzing state has expectation failures");
    });

    function createAgentOptions(): AgentBotDefaultSettings {
        const class1Collateral = randomChoice(context.collaterals.filter(isClass1Collateral));//TODO does this work?
        const poolCollateral = context.collaterals.filter(isPoolCollateral)[0];//TODO does this work?
        const mintingClass1CollateralRatioBIPS = mulDecimal(toBN(class1Collateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        const mintingPoolCollateralRatioBIPS = mulDecimal(toBN(poolCollateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        return {
            class1CollateralToken: class1Collateral.token,
            feeBIPS: toBIPS("5%"),
            poolFeeShareBIPS: toBIPS("40%"),
            mintingClass1CollateralRatioBIPS: mintingClass1CollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: mintingPoolCollateralRatioBIPS,
            poolExitCollateralRatioBIPS: mulDecimal(mintingPoolCollateralRatioBIPS, randomNum(1, 1.25)),
            buyFAssetByAgentFactorBIPS: toBIPS(0.9),
            poolTopupCollateralRatioBIPS: toBN(randomInt(Number(poolCollateral.minCollateralRatioBIPS), Number(mintingPoolCollateralRatioBIPS))),
            poolTopupTokenPriceFactorBIPS: toBIPS(0.8),
        };
    }

    async function timeInfo() {
        return `block=${await time.latestBlock()} timestamp=${await latestBlockTimestamp() - startTimestamp}  ` +
            `underlyingBlock=${chain.blockHeight()} underlyingTimestamp=${chain.lastBlockTimestamp() - startTimestamp}  ` +
            `skew=${await latestBlockTimestamp() - chain.lastBlockTimestamp()}  ` +
            `realTime=${(currentRealTime() - startTimestamp).toFixed(3)}`;
    }

    async function refreshAvailableAgents() {
        await runner.refreshAvailableAgentBots();
    }

    async function updateUnderlyingBlock() {
        await proveAndUpdateUnderlyingBlock(context);
    }

    async function testMint() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.minting(scope));
    }

    async function testSelfMint() {
        const agentBot = randomChoice(agentBots);
        runner.startThread((scope) => agentBot.selfMint(scope));
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

    async function testConvertDustToTicket() {
        const agentBot = randomChoice(agentBots);
        runner.startThread((scope) => agentBot.convertDustToTicket(scope));
    }

    async function testIllegalTransaction() {
        const agentBot = randomChoice(agentBots);
        runner.startThread(() => agentBot.makeIllegalTransaction());
    }

    async function testDoublePayment() {
        const agentBot = randomChoice(agentBots);
        runner.startThread(() => agentBot.makeDoublePayment());
    }

    async function testEnterPool() {
        const lpholder = randomChoice(poolTokenHolders);
        runner.startThread((scope) => lpholder.enter(scope));
    }

    async function testExitPool() {
        const lpholder = randomChoice(poolTokenHolders);
        const fullExit = coinFlip();
        runner.startThread((scope) => lpholder.exit(scope, fullExit));
    }

    async function testChangeLotSize(index: number) {
        const lotSizeAMG = toBN((await context.assetManager.getSettings()).lotSizeAMG);
        const factor = CHANGE_LOT_SIZE_FACTOR.length > 0 ? CHANGE_LOT_SIZE_FACTOR[index % CHANGE_LOT_SIZE_FACTOR.length] : randomNum(0.5, 2);
        const newLotSizeAMG = mulDecimal(lotSizeAMG, factor);
        runner.comment(`Changing lot size by factor ${factor}, old=${formatBN(lotSizeAMG)}, new=${formatBN(newLotSizeAMG)}`);
        await setLotSizeAmg(newLotSizeAMG, context, governance)
            .catch(e => expectErrors(e, ['too close to previous update']));
    }

    async function testChangePrices() {
        for (const [symbol, ftso] of Object.entries(context.ftsos)) {
            const [minFactor, maxFactor] = CHANGE_PRICE_FACTOR[symbol] ?? CHANGE_PRICE_FACTOR['default'] ?? [0.9, 1.1];
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
        if (miningMode === 'manual') {
            await network.provider.send('evm_setAutomine', [false]);
            await network.provider.send("evm_setIntervalMining", [interval]);
        } else {
            await network.provider.send("evm_setIntervalMining", [0]);
            await network.provider.send('evm_setAutomine', [true]);
        }
    }

    function isClass1Collateral(collateral: CollateralType) {
        return Number(collateral.collateralClass) === CollateralClass.CLASS1 && Number(collateral.validUntil) === 0;
    }

});
