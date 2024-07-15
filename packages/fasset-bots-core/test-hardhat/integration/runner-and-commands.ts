import { time } from "@nomicfoundation/hardhat-network-helpers";
import { AgentBotCommands, AgentBotRunner, ChainId, TimeKeeperService, UserBotCommands } from "../../src";
import { AgentBotSettings, AgentSettingsConfig, Secrets } from "../../src/config";
import { ORM } from "../../src/config/orm";
import { IAssetAgentContext } from "../../src/fasset-bots/IAssetBotContext";
import { OwnerAddressPair } from "../../src/fasset/Agent";
import { MockChain } from "../../src/mock/MockChain";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { Currencies, Currency } from "../../src/utils";
import { Web3ContractEventDecoder } from "../../src/utils/events/Web3ContractEventDecoder";
import { EvmEvent } from "../../src/utils/events/common";
import { eventIs } from "../../src/utils/events/truffle";
import { firstValue, getOrCreateAsync, sleep, toBNExp } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { TestChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { testNotifierTransports } from "../../test/test-utils/testNotifierTransports";
import { FakeERC20Instance, IERC20MetadataInstance, Truffle } from "../../typechain-truffle";
import { TestAssetBotContext, createTestAssetContext, createTestChain, createTestChainContracts, createTestSecrets, testTimekeeperTimingConfig } from "../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../test-utils/hardhat-test-helpers";

const StateConnector = artifacts.require("StateConnectorMock");

describe("Toplevel runner and commands integration test", () => {
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

    const newAgentSettings: AgentSettingsConfig = {
        poolTokenSuffix: "TESTAGNT",
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
        parallel: false,
        liquidationPreventionFactor: 1.2,
        vaultCollateralReserveFactor: 0.1,
        poolCollateralReserveFactor: 0.1,
        minimumFreeUnderlyingBalance: toBNExp(12, 6),
        recommendedOwnerUnderlyingBalance: toBNExp(50, 6),
    };

    const testChainInfos = [testXrpChainInfo, simCoinXChainInfo];

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
        timekeeperService = new TimeKeeperService(contexts, ownerWorkAddress, testTimekeeperTimingConfig({ loopDelayMs: loopDelay }));
        // agent bot runner
        botRunner = new AgentBotRunner(secrets, contexts, agentBotSettingsMap, orm, loopDelay, testNotifierTransports, timekeeperService);
        // currencies
        const usdc = context0.stablecoins.usdc as FakeERC20Instance;
        usdcCurrency = await Currencies.erc20(usdc as IERC20MetadataInstance);
        natCurrency = await Currencies.evmNative(context0);
        xrpCurrency = Currencies.chain(testXrpChainInfo);
        // mint some collaterals to owner
        await usdc.mintAmount(ownerWorkAddress, usdcCurrency.parse("1000"));
        // mint some underlying
        for (const chain of chains.values()) {
            // to owner
            chain.mint(ownerUnderlyingAddress, xrpCurrency.parse("100"));
            chain.mine(chain.finalizationBlocks + 1);  // add enough blocks for finalized block proof to succeed
            // mint some xrp to user
            chain.mint(userUnderlyingAddress, xrpCurrency.parse("1000"));
        }
        //
        console.log("Context created.");
        return { orm, contexts, agentBotSettingsMap, chains, timekeeperService, botRunner };
    }

    beforeEach(async () => {
        ({ orm, contexts, agentBotSettingsMap, chains, timekeeperService, botRunner } = await loadFixtureCopyVars(initialize));
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
        await Promise.allSettled(Array.from(contexts.values()).map(async context => {
            console.log(`***** Testing for asset ${context.chainInfo.symbol} *****`);
            const agentCommands = createAgentCommands(context);
            const userCommands = await createUserCommands(context);
            //
            const agent = await agentCommands.createAgentVault(newAgentSettings);
            const agentVault = agent.vaultAddress;
            await agentCommands.depositToVault(agentVault, usdcCurrency.parse("100"));
            await agentCommands.buyCollateralPoolTokens(agentVault, natCurrency.parse("100000"));
            await agentCommands.enterAvailableList(agentVault);
            await userCommands.infoBot().printAvailableAgents();
            // mint
            await userCommands.mint(agentVault, 10, false);
            // redeem
            const lastBlock = await web3.eth.getBlockNumber();
            await userCommands.redeem(10);
            await waitForEvent(context.assetManager, lastBlock, 5000, (ev) => eventIs(ev, context.assetManager, "RedemptionPerformed") && ev.args.agentVault === agentVault);
            // close
            const lastBlock2 = await web3.eth.getBlockNumber();
            await agentCommands.closeVault(agentVault);
            // wait for close process to finish (speed up time to rush through all the timelocks)
            const tm1 = setInterval(() => void time.increase(100), 200);
            try {
                await waitForEvent(context.assetManager, lastBlock2, 20000, (ev) => eventIs(ev, context.assetManager, "AgentDestroyed") && ev.args.agentVault === agentVault);
            } finally {
                clearInterval(tm1);
            }
        }));
    });

    it("create agent vault, mint, and agent executes mint", async () => {
        const context = firstValue(contexts)!;
        const agentCommands = createAgentCommands(context);
        const userCommands = await createUserCommands(context);
        const chain = context.blockchainIndexer.chain;
        //
        const agent = await agentCommands.createAgentVault(newAgentSettings);
        const agentVault = agent.vaultAddress;
        await agentCommands.depositToVault(agentVault, usdcCurrency.parse("100"));
        await agentCommands.buyCollateralPoolTokens(agentVault, natCurrency.parse("100000"));
        await agentCommands.enterAvailableList(agentVault);
        // mint
        const lastEvmBlock = await web3.eth.getBlockNumber();
        await userCommands.mint(agentVault, 10, true);
        chain.mine(300);    // agent will only execute minting once the time for payment expires on underlying chain
        await waitForEvent(context.assetManager, lastEvmBlock, 5000, (ev) => eventIs(ev, context.assetManager, "MintingExecuted") && ev.args.agentVault === agentVault);
    });
});
