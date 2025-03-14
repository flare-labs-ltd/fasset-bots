import { time } from "@openzeppelin/test-helpers";
import { assert } from "chai";
import { network } from "hardhat";
import { Challenger } from "../../src/actors/Challenger";
import { Liquidator } from "../../src/actors/Liquidator";
import { SystemKeeper } from "../../src/actors/SystemKeeper";
import { TimeKeeper } from "../../src/actors/TimeKeeper";
import { AgentBotCommands } from "../../src/commands/AgentBotCommands";
import { AgentBotSettings } from "../../src/config";
import { AgentVaultInitSettings } from "../../src/config/AgentVaultInitSettings";
import { OwnerAddressPair } from "../../src/fasset/Agent";
import { CollateralClass, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { isPoolCollateral } from "../../src/state/CollateralIndexedList";
import { expectErrors, sleep, sumBN, systemTimestamp, toBIPS, toBN } from "../../src/utils/helpers";
import { NotifierTransport } from "../../src/utils/notifier/BaseNotifier";
import { web3 } from "../../src/utils/web3";
import { latestBlockTimestamp } from "../../src/utils/web3helpers";
import { TestChainInfo, TestChainType, testAgentBotSettings, testChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { EventFormatter } from "../test-utils/EventFormatter";
import { TestAssetBotContext, createTestAssetContext, testTimekeeperTimingConfig } from "../test-utils/create-test-asset-context";
import { InclusionIterable, currentRealTime, getEnv, mulDecimal, randomChoice, randomInt, randomNum, toWei, weightedRandomChoice } from "../test-utils/fuzzing-utils";
import { DEFAULT_POOL_TOKEN_SUFFIX, createTestAgentAndMakeAvailable, createTestAgentBotAndMakeAvailable, createTestMinter } from "../test-utils/helpers";
import { FuzzingAgentBot } from "./FuzzingAgentBot";
import { FuzzingCustomer } from "./FuzzingCustomer";
import { FuzzingNotifierTransport } from "./FuzzingNotifierTransport";
import { FuzzingRunner } from "./FuzzingRunner";
import { FuzzingState } from "./FuzzingState";
import { FuzzingStateComparator } from "./FuzzingStateComparator";
import { FuzzingTimeline } from "./FuzzingTimeline";

export type MiningMode = "auto" | "manual";

describe("Fuzzing tests", () => {
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
    const ILLEGAL_PROB = getEnv("ILLEGAL_PROB", "number", 1); // likelihood of illegal operations (not normalized)

    const agentBots: FuzzingAgentBot[] = [];
    const customers: FuzzingCustomer[] = [];
    const keepers: SystemKeeper[] = [];
    const liquidators: Liquidator[] = [];
    let challenger: Challenger;
    let chainInfo: TestChainInfo;
    let agentBotSettings: AgentBotSettings;
    let chain: MockChain;
    let eventFormatter: EventFormatter;
    let runner: FuzzingRunner;
    let notifiers: NotifierTransport[];

    before(async () => {
        accounts = await web3.eth.getAccounts();
        governance = accounts[1];
        // create context
        chainInfo = testChainInfo[CHAIN as TestChainType] ?? assert.fail(`Invalid chain ${CHAIN}`);
        agentBotSettings = testAgentBotSettings[CHAIN as TestChainType];
        context = await createTestAssetContext(governance, chainInfo);
        chain = context.blockchainIndexer.chain as MockChain;
        // create interceptor
        eventFormatter = new EventFormatter();
        notifiers = [new FuzzingNotifierTransport(eventFormatter)];
        // state checker
        commonTrackedState = new FuzzingState(context, new MockChainWallet(chain));
        await commonTrackedState.initialize();
        // runner
        runner = new FuzzingRunner(context, AVOID_ERRORS, commonTrackedState, eventFormatter);
        // timeline
        timeline = new FuzzingTimeline(chain, runner);
    });

    it("f-asset fuzzing test", async () => {
        // create bots
        const orm = await createTestOrm({ dbName: "fasset-bots-test_fuzzing.db" });
        const firstAgentAddress = 10;
        for (let i = 0; i < N_AGENTS; i++) {
            const ownerAddress = accounts[firstAgentAddress + i];
            eventFormatter.addAddress("OWNER_ADDRESS_" + i, ownerAddress);
            const ownerUnderlyingAddress = "underlying_owner_agent_" + i;
            const options = createAgentOptions();
            const agentBot = await createTestAgentBotAndMakeAvailable(context, orm, ownerAddress, ownerUnderlyingAddress, true, notifiers, options, governance);
            const owner = new OwnerAddressPair(ownerAddress, ownerAddress);
            const botCliCommands = new AgentBotCommands(context, agentBotSettings, owner, ownerUnderlyingAddress, orm, notifiers);
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
            const liquidator = new Liquidator(context, runner, accounts[firstLiquidatorAddress + i], commonTrackedState, notifiers);
            liquidators.push(liquidator);
            // await context.fAsset.mint(accounts[1], 100);
            eventFormatter.addAddress(`LIQUIDATOR_${i}`, liquidator.address);
            await transferFassetsToLiquidator(liquidator.address);
        }
        // create challenger
        const challengerAddress = accounts[firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + N_LIQUIDATORS];
        challenger = new Challenger(context, runner, challengerAddress, commonTrackedState, await context.blockchainIndexer.chain.getLastFinalizedBlockNumber(), notifiers);
        eventFormatter.addAddress(`CHALLENGER`, challenger.address);
        // create time keeper
        const timeKeeperAddress = accounts[firstAgentAddress + 3 * N_AGENTS + N_CUSTOMERS + N_KEEPERS + N_LIQUIDATORS + 1];
        const timeKeeper = new TimeKeeper(context, timeKeeperAddress, testTimekeeperTimingConfig({ queryWindow: 7200 }));
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
                // update agents
                await refreshAvailableAgents();
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
        timeKeeper.stop();
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
        // assert.isTrue(commonTrackedState.failedExpectations.length === 0, "fuzzing state has expectation failures");
    });

    function createAgentOptions(): AgentVaultInitSettings {
        const vaultCollateral = randomChoice(context.collaterals.filter(isVaultCollateral));
        const poolCollateral = context.collaterals.filter(isPoolCollateral)[0];
        const mintingVaultCollateralRatioBIPS = mulDecimal(toBN(vaultCollateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        const mintingPoolCollateralRatioBIPS = mulDecimal(toBN(poolCollateral.minCollateralRatioBIPS), randomNum(1, 1.5));
        return {
            vaultCollateralToken: vaultCollateral.token,
            poolTokenSuffix: "FUZZ" + DEFAULT_POOL_TOKEN_SUFFIX(),
            feeBIPS: toBIPS("5%"),
            poolFeeShareBIPS: toBIPS("40%"),
            mintingVaultCollateralRatioBIPS: mintingVaultCollateralRatioBIPS,
            mintingPoolCollateralRatioBIPS: mintingPoolCollateralRatioBIPS,
            poolExitCollateralRatioBIPS: mulDecimal(mintingPoolCollateralRatioBIPS, randomNum(1, 1.25)),
            buyFAssetByAgentFactorBIPS: toBIPS(0.9),
            poolTopupCollateralRatioBIPS: toBN(randomInt(Number(poolCollateral.minCollateralRatioBIPS), Number(mintingPoolCollateralRatioBIPS))),
            poolTopupTokenPriceFactorBIPS: toBIPS(0.8),
            handshakeType: toBN(0),
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

    const allFtsoSymbols = ["NAT", "testUSDC", "testUSDT", "testETH", ...Object.values(testChainInfo).map(ci => ci.symbol)];

    async function testChangePrices() {
        for (const symbol of allFtsoSymbols) {
            const [minFactor, maxFactor] = CHANGE_PRICE_FACTOR?.[symbol] ?? CHANGE_PRICE_FACTOR?.['default'] ?? [0.9, 1.1];
            await _changePriceOnFtso(symbol, randomNum(minFactor, maxFactor));
        }
        await context.priceStore.finalizePrices();
    }

    async function _changePriceOnFtso(symbol: string, factor: number) {
        const { 0: price } = await context.priceStore.getPrice(symbol);
        const newPrice = mulDecimal(price, factor);
        await context.priceStore.setCurrentPrice(symbol, newPrice, 0);
        await context.priceStore.setCurrentPriceFromTrustedProviders(symbol, newPrice, 0);
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
        const agentB = await createTestAgentAndMakeAvailable(context, accounts[1000], "TEMP_UNDERLYING", true, governance);
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
