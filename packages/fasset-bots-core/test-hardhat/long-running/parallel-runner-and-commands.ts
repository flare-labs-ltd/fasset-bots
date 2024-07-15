import { time } from "@nomicfoundation/hardhat-network-helpers";
import { AgentBotCommands, AgentBotRunner, ChainId, TimeKeeperService, UserBotCommands } from "../../src";
import { AgentBotSettings, AgentSettingsConfig, Secrets } from "../../src/config";
import { ORM } from "../../src/config/orm";
import { IAssetAgentContext } from "../../src/fasset-bots/IAssetBotContext";
import { Agent, OwnerAddressPair } from "../../src/fasset/Agent";
import { MockChain } from "../../src/mock/MockChain";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { Currencies, Currency } from "../../src/utils";
import { Web3ContractEventDecoder } from "../../src/utils/events/Web3ContractEventDecoder";
import { EvmEvent } from "../../src/utils/events/common";
import { eventIs } from "../../src/utils/events/truffle";
import { BN_ZERO, DAYS, enumerate, fail, firstValue, getOrCreateAsync, HOURS, sleep, toBN, toBNExp } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { TestChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { testNotifierTransports } from "../../test/test-utils/testNotifierTransports";
import { FakeERC20Instance, IERC20MetadataInstance, Truffle } from "../../typechain-truffle";
import { createTestAssetContext, createTestChain, createTestChainContracts, createTestSecrets, TestAssetBotContext, testTimekeeperTimingConfig } from "../test-utils/create-test-asset-context";

const StateConnector = artifacts.require("StateConnectorMock");

describe("Toplevel runner and commands integration test - massively parallel version", () => {
    const loopDelay = 100; // ms
    let accounts: string[];
    let orm: ORM;
    let ownerManagementAddress: string;
    const ownerUnderlyingAddress = "owner_underlying_1";
    let ownerWorkAddress: string;
    let userAddress: string;
    let submitterAddress: string;
    const userUnderlyingAddress = "user_underlying_1";
    let contexts: Map<string, TestAssetBotContext> = new Map();
    let agentBotSettingsMap: Map<string, AgentBotSettings> = new Map();
    let chains: Map<ChainId, MockChain> = new Map();
    let secrets: Secrets;
    let timekeeperService: TimeKeeperService;
    let botRunner: AgentBotRunner;
    let usdcCurrency: Currency;
    let natCurrency: Currency;
    let xrpCurrency: Currency;

    function newAgentSettings(i: number): AgentSettingsConfig {
        return {
            poolTokenSuffix: "TESTAGNT" + i,
            vaultCollateralFtsoSymbol: "testUSDC",
            fee: "0.25%",
            poolFeeShare: "40%",
            mintingVaultCollateralRatio: "1.6",
            mintingPoolCollateralRatio: "2.4",
            poolExitCollateralRatio: "2.6",
            poolTopupCollateralRatio: "2.2",
            poolTopupTokenPriceFactor: "0.8",
            buyFAssetByAgentFactor: "0.99"
        };
    }

    const testXrpChainInfo: TestChainInfo = {
        chainId: ChainId.testXRP,
        name: "Test XRP",
        symbol: "testXRP",
        decimals: 6,
        amgDecimals: 6,
        minimumAccountBalance: toBNExp(10, 6),
        startPrice: 0.53,
        blockTime: 2,
        finalizationBlocks: 3,
        underlyingBlocksForPayment: 100,
        lotSize: 10,
        requireEOAProof: false,
        parameterFile: "./fasset-config/coston/f-testxrp.json",
    };

    const simCoinXChainInfo: TestChainInfo = {
        ...testXrpChainInfo,
        startPrice: 0.60,
        parameterFile: "./fasset-config/coston/f-simcoinx.json",
    };

    const agentBotSettings: AgentBotSettings = {
        parallel: true,
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumFreeUnderlyingBalance: toBNExp(0.01, 6),
        recommendedOwnerUnderlyingBalance: toBNExp(50, 6),
    };

    // const testChainInfos = [testXrpChainInfo, simCoinXChainInfo];
    const testChainInfos = [testXrpChainInfo];

    async function waitForEvent(contract: Truffle.ContractInstance, fromBlock: number, maxWaitMs: number, predicate: (event: EvmEvent) => boolean) {
        const sleepTime = 100;
        const eventDecoder = new Web3ContractEventDecoder({ contract });
        for (let t = 0; t < maxWaitMs; t += sleepTime) {
            const toBlock = await web3.eth.getBlockNumber();
            if (fromBlock <= toBlock) {
                const rawEvents = await web3.eth.getPastLogs({ address: contract.address, fromBlock, toBlock });
                const events = eventDecoder.decodeEvents(rawEvents);
                for (const event of events) {
                    if (predicate(event)) return;
                }
                fromBlock = toBlock + 1;
            }
            await sleep(sleepTime);
        }
        throw new Error(`Event did not occur in ${maxWaitMs}ms`);
    }

    function createAgentCommands(context: IAssetAgentContext) {
        const ownerAddressPair = new OwnerAddressPair(ownerManagementAddress, ownerWorkAddress);
        return new AgentBotCommands(context, agentBotSettings, ownerAddressPair, ownerUnderlyingAddress, orm, testNotifierTransports);
    }

    async function createUserCommands(context: IAssetAgentContext) {
        return new UserBotCommands(context, context.fAssetSymbol, userAddress, userUnderlyingAddress, "./test-data");
    }

    async function increaseTimes(chain: MockChain, skip: number) {
        await time.increase(skip);
        chain.skipTime(skip);
        chain.mine(skip / 10);
    }

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerManagementAddress = accounts[2];
        ownerWorkAddress = accounts[3];
        userAddress = accounts[4];
        submitterAddress = accounts[5];
    });

    async function initialize() {
        console.log("Creating context...");
        orm = await createTestOrm();
        const contracts = await createTestChainContracts(accounts[0]);
        const stateConnector = await StateConnector.at(contracts.StateConnector.address);
        const stateConnectorClient = new MockStateConnectorClient(stateConnector, {}, "auto", submitterAddress);
        // secrets
        secrets = createTestSecrets(testChainInfos.map(ci => ci.chainId), ownerManagementAddress, ownerWorkAddress, ownerUnderlyingAddress);
        // create contexts
        for (const chainInfo of testChainInfos) {
            const chain = await getOrCreateAsync(chains, chainInfo.chainId, () => createTestChain(chainInfo));
            const context = await createTestAssetContext(accounts[0], chainInfo, { contracts, chain, stateConnectorClient });
            contexts.set(context.fAssetSymbol, context);
            agentBotSettingsMap.set(context.fAssetSymbol, agentBotSettings);
        }
        // set work address mapping
        const context0 = firstValue(contexts)!;
        await context0.agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: ownerManagementAddress });
        // timekeeper
        timekeeperService = new TimeKeeperService(contexts, ownerWorkAddress, testTimekeeperTimingConfig({ loopDelayMs: loopDelay, updateIntervalMs: 10_000 }));
        // agent bot runner
        botRunner = new AgentBotRunner(secrets, contexts, agentBotSettingsMap, orm, loopDelay, testNotifierTransports, timekeeperService);
        // currencies
        const usdc = context0.stablecoins.usdc as FakeERC20Instance;
        usdcCurrency = await Currencies.erc20(usdc as IERC20MetadataInstance);
        natCurrency = await Currencies.evmNative(context0);
        xrpCurrency = Currencies.chain(testXrpChainInfo);
        // mint some collaterals to owner
        await usdc.mintAmount(ownerWorkAddress, usdcCurrency.parse("1000000"));
        // mint some underlying
        for (const chain of chains.values()) {
            // to owner
            chain.mint(ownerUnderlyingAddress, xrpCurrency.parse("100"));
            chain.mine(chain.finalizationBlocks + 1);  // add enough blocks for finalized block proof to succeed
            // mint some xrp to user
            chain.mint(userUnderlyingAddress, xrpCurrency.parse("1000000"));
        }
        //
        console.log("Context created.");
        return { orm, contexts, agentBotSettingsMap, chains, timekeeperService, botRunner };
    }

    beforeEach(async () => {
        ({ orm, contexts, agentBotSettingsMap, chains, timekeeperService, botRunner } = await initialize());
        // start runners in background
        console.log("Starting the bots...");
        timekeeperService.startAll();
        void botRunner.run();
        while (!botRunner.running) {
            await sleep(100);
        }
        for (const chain of chains.values()) {
            chain.enableTimedMining(500);
        }
    });

    afterEach(async () => {
        console.log("Stopping the bots...");
        for (const chain of chains.values()) {
            chain.disableTimedMining();
        }
        botRunner.requestStop();
        while (botRunner.running) {
            await sleep(100);
        }
        await timekeeperService.stopAll();
    });

    it("create agent vault, mint, redeem, and close", async () => {
        const context = firstValue(contexts) ?? fail("no context");
        const chain = chains.get(context.chainInfo.chainId)!;
        console.log(`***** Testing for asset ${context.chainInfo.symbol} *****`);
        const agentCommands = createAgentCommands(context);
        const userCommands = await createUserCommands(context);
        //
        const NAG = 5;
        const agents: Agent[] = [];
        for (let i = 0; i < NAG; i++) {
            const agent = await agentCommands.createAgentVault(newAgentSettings(i));
            const agentVault = agent.vaultAddress;
            await agentCommands.depositToVault(agentVault, usdcCurrency.parse("10000"));
            await agentCommands.buyCollateralPoolTokens(agentVault, natCurrency.parse("3000000"));
            await agentCommands.enterAvailableList(agentVault);
            agents.push(agent);
        }
        await userCommands.infoBot().printAvailableAgents();
        // cleanup state dir
        for (const state of userCommands.readStateList("redeem")) {
            userCommands.deleteState(state);
        }
        // mint and redeem
        for (let i = 0; i < 300; i++) {
            if (i % 10 === 0) {
                console.log(`Minting ${i}...`);
                await userCommands.mint(agents[(i / 10) % NAG].vaultAddress, 9, false);
            } else {
                console.log(`Redeeming ${i}...`);
                await userCommands.redeem(1);
            }
            await sleep(0);
        }
        // execute defaults for expired redemptions
        let totalSuccessful = 0;
        let totalDefaulted = 0;
        let totalExpired = 0;
        while (true) {
            // update all redemptions
            const res = await userCommands.updateAllRedemptions();
            console.log(`Redemptions: total=${res.total}, successful=${res.successful}, defaulted=${res.defaulted}, expired=${res.expired}, remaining=${res.expired}`);
            totalSuccessful += res.successful;
            totalDefaulted += res.defaulted;
            totalExpired += res.expired;
            // print agent info
            for (const [agent, i] of enumerate(agents)) {
                const info = await agent.getAgentInfo();
                console.log(`${i}: minted=${xrpCurrency.format(info.mintedUBA)}   Redeeming=${xrpCurrency.format(info.redeemingUBA)}`);
            }
            //
            if (res.remaining === 0) break;
            await sleep(3000);
        }
        // skip until all proofs expire
        let skippedTime = 0;
        while (true) {
            await increaseTimes(chain, 2 * HOURS);
            skippedTime += 2 * HOURS;
            await sleep(1000);
            //
            let totalRedeeming = BN_ZERO;
            for (const [agent, i] of enumerate(agents)) {
                const info = await agent.getAgentInfo();
                console.log(`${i}: WAITING EXPIRATION: minted=${xrpCurrency.format(info.mintedUBA)}   Redeeming=${xrpCurrency.format(info.redeemingUBA)}`);
                totalRedeeming = totalRedeeming.add(toBN(info.redeemingUBA));
            }
            if (totalRedeeming.eq(BN_ZERO) && skippedTime > 5 * DAYS) break;
        }
        // close
        const lastBlock2 = await web3.eth.getBlockNumber();
        // wait for close process to finish (speed up time to rush through all the timelocks)
        const timeSpeedupTimer = setInterval(() => void time.increase(100), 200);
        try {
            await Promise.allSettled(agents.map(async (agent) => {
                await agentCommands.closeVault(agent.vaultAddress);
                await waitForEvent(context.assetManager, lastBlock2, 2000000, (ev) => eventIs(ev, context.assetManager, "AgentDestroyed") && ev.args.agentVault === agent.vaultAddress);
            }));
        } finally {
            clearInterval(timeSpeedupTimer);
        }
        console.log(`Redemption totals: successful=${totalSuccessful}, defaulted=${totalDefaulted}, expired=${totalExpired}`);
    });
});
