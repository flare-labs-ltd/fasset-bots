import { TestAssetBotContext, createTestAssetContext, setLotSizeAmg } from "../test-utils/create-test-asset-context";
import { ORM } from "../../src/config/orm";
import { createTestAgentBotAndMakeAvailable, disableMccTraceManager } from "../test-utils/helpers";
import { overrideAndCreateOrm } from "../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../test/test-utils/test-bot-config";
import { web3 } from "../../src/utils/web3";
import { MockChain } from "../../src/mock/MockChain";
import { expectErrors, sleep, systemTimestamp, toBIPS, toBN } from "../../src/utils/helpers";
import { InclusionIterable, coinFlip, currentRealTime, getEnv, mulDecimal, randomChoice, randomInt, randomNum, toWei, weightedRandomChoice } from "../test-utils/fuzzing-utils";
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

export type MiningMode = 'auto' | 'manual'

describe("Fuzzing tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let governance: string;


    const startTimestamp = systemTimestamp();

    const CHAIN = getEnv('CHAIN', 'string', 'xrp');
    const LOOPS = getEnv('LOOPS', 'number', 100);
    const AUTOMINE = getEnv('AUTOMINE', 'boolean', true);
    const N_AGENTS = getEnv('N_AGENTS', 'number', 10);
    const N_CUSTOMERS = getEnv('N_CUSTOMERS', 'number', 10);     // minters and redeemers
    const N_KEEPERS = getEnv('N_KEEPERS', 'number', 1);
    const N_POOL_TOKEN_HOLDERS = getEnv('N_POOL_TOKEN_HOLDERS', 'number', 20);
    const CUSTOMER_BALANCE = toWei(getEnv('CUSTOMER_BALANCE', 'number', 10_000));  // initial underlying balance
    const AVOID_ERRORS = getEnv('AVOID_ERRORS', 'boolean', true);
    const CHANGE_LOT_SIZE_AT = getEnv('CHANGE_LOT_SIZE_AT', 'range', null);
    const CHANGE_LOT_SIZE_FACTOR = getEnv('CHANGE_LOT_SIZE_FACTOR', 'number[]', []);
    const CHANGE_PRICE_AT = getEnv('CHANGE_PRICE_AT', 'range', null);
    const CHANGE_PRICE_FACTOR = getEnv('CHANGE_PRICE_FACTOR', 'json', null) as { [key: string]: [number, number] };
    const ILLEGAL_PROB = getEnv('ILLEGAL_PROB', 'number', 1);     // likelihood of illegal operations (not normalized)

    // let timeline: FuzzingTimeline;
    const agentBots: FuzzingAgentBot[] = [];
    const customers: FuzzingCustomer[] = [];
    const keepers: SystemKeeper[] = [];
    const poolTokenHolders: FuzzingPoolTokenHolder[] = [];
    let challenger: Challenger;
    let chainInfo: TestChainInfo;
    let chain: MockChain;
    // let eventDecoder: Web3EventDecoder;
    // let interceptor: TruffleTransactionInterceptor;
    // let truffleEvents: InterceptorEvmEvents;
    // let eventQueue: EventExecutionQueue;
    // let chainEvents: UnderlyingChainEvents;
    let trackedState: TrackedState;
    // let logger: LogFile;
    let runner: FuzzingRunner;
    // let checkedInvariants = false;

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        governance = accounts[1];
        // create context
        chainInfo = testChainInfo[CHAIN as keyof typeof testChainInfo] ?? assert.fail(`Invalid chain ${CHAIN}`);
        context = await createTestAssetContext(governance, chainInfo)
        chain = context.chain as MockChain;
        // create interceptor
        // eventDecoder = new Web3EventDecoder({});
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
        trackedState = new TrackedState(context, lastBlock);
        await trackedState.initialize();
        // runner
        runner = new FuzzingRunner(context, trackedState, AVOID_ERRORS);
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
        // create agents
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            console.log("integer", i);
            const ownerAddress = accounts[firstAgentAddress + i];
            console.log(firstAgentAddress, ownerAddress);
            const options = createAgentOptions();//TODO use opt
            const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, options)
            const fuzzingAgentBot = new FuzzingAgentBot(agentBot, runner, orm.em);
            agentBots.push(fuzzingAgentBot);
        }
        // create customers
        const firstCustomerAddress = firstAgentAddress + 3 * N_AGENTS;
        for (let i = 0; i < N_CUSTOMERS; i++) {
            const underlyingAddress = "underlying_customer_" + i;
            const customer = await FuzzingCustomer.createTest(runner, accounts[firstCustomerAddress + i], underlyingAddress, CUSTOMER_BALANCE);
            chain.mint(underlyingAddress, 1_000_000);
            customers.push(customer);
            // eventDecoder.addAddress(`CUSTOMER_${i}`, customer.address);
        }
        // create liquidators
        const firstKeeperAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS;
        for (let i = 0; i < N_KEEPERS; i++) {
            const keeper = new SystemKeeper(runner, accounts[firstKeeperAddress + i], trackedState);
            keepers.push(keeper);
            // eventDecoder.addAddress(`KEEPER_${i}`, keeper.address);
        }
        // create challenger
        const challengerAddress = accounts[firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS];
        challenger = new Challenger(runner, challengerAddress, trackedState, await context.chain.getBlockHeight());
        // eventDecoder.addAddress(`CHALLENGER`, challenger.address);
        // create pool token holders
        const firstPoolTokenHolderAddress = firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + 1;
        for (let i = 0; i < N_POOL_TOKEN_HOLDERS; i++) {
            const lpholder = new FuzzingPoolTokenHolder(runner, accounts[firstPoolTokenHolderAddress + i]);
            poolTokenHolders.push(lpholder);
            // eventDecoder.addAddress(`POOL_TOKEN_HOLDER_${i}`, lpholder.address);
        }
        // await interceptor.allHandled();
        // init some state
        await refreshAvailableAgents();
        // actions
        const actions: Array<[() => Promise<void>, number]> = [
            [testMint, 10],
            [testRedeem, 10],
            [testSelfMint, 10],
            [testSelfClose, 10],
            [testLiquidate, 10],
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
            // if (loop % 10 === 0) {
            //     // run all queued event handlers
            //     // eventQueue.runAll();
            //     await fuzzingState.checkInvariants(false);     // state change may happen during check, so we don't wany failure here
            //     interceptor.comment(`-----  LOOP ${loop}  ${await timeInfo()}  -----`);
            //     await timeline.skipTime(100);
            //     await timeline.executeTriggers();
            //     await interceptor.allHandled();
            // }
        }
        // wait for all threads to finish
        // interceptor.comment(`Remaining threads: ${runner.runningThreads}`);
        // while (runner.runningThreads > 0) {
        //     await sleep(200);
        //     await timeline.skipTime(100);
        //     // interceptor.comment(`-----  WAITING  ${await timeInfo()}  -----`);
        //     await timeline.executeTriggers();
        //     await interceptor.allHandled();
        //     while (eventQueue.length > 0) {
        //         eventQueue.runAll();
        //         await interceptor.allHandled();
        //     }
        // }
        // fail immediately on unexpected errors from threads
        if (runner.uncaughtErrors.length > 0) {
            throw runner.uncaughtErrors[0];
        }
        // interceptor.comment(`Remaining threads: ${runner.runningThreads}`);
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
        runner.startThread((scope) => agentBot.announcedUnderlyingWithdrawal(scope));
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

    async function testLiquidate() {
        const customer = randomChoice(customers);
        runner.startThread((scope) => customer.liquidate(scope));
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
        const lotSizeAMG = toBN(trackedState.settings.lotSizeAMG);
        const factor = CHANGE_LOT_SIZE_FACTOR.length > 0 ? CHANGE_LOT_SIZE_FACTOR[index % CHANGE_LOT_SIZE_FACTOR.length] : randomNum(0.5, 2);
        const newLotSizeAMG = mulDecimal(lotSizeAMG, factor);
        // interceptor.comment(`Changing lot size by factor ${factor}, old=${formatBN(lotSizeAMG)}, new=${formatBN(newLotSizeAMG)}`);
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
