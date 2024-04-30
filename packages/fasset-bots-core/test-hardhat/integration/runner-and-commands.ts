import { time } from "@nomicfoundation/hardhat-network-helpers";
import { AgentBotCommands, AgentBotRunner, SourceId, TimeKeeperService, UserBotCommands } from "../../src";
import { AgentSettingsConfig, Secrets, decodedChainId } from "../../src/config";
import { ORM } from "../../src/config/orm";
import { OwnerAddressPair } from "../../src/fasset/Agent";
import { AssetManagerSettings } from "../../src/fasset/AssetManagerTypes";
import { MockChain } from "../../src/mock/MockChain";
import { Currencies, Currency } from "../../src/utils";
import { Web3ContractEventDecoder } from "../../src/utils/events/Web3ContractEventDecoder";
import { EvmEvent } from "../../src/utils/events/common";
import { eventIs } from "../../src/utils/events/truffle";
import { checkedCast, sleep } from "../../src/utils/helpers";
import { web3 } from "../../src/utils/web3";
import { TestChainInfo } from "../../test/test-utils/TestChainInfo";
import { createTestOrm } from "../../test/test-utils/create-test-orm";
import { testNotifierTransports } from "../../test/test-utils/testNotifierTransports";
import { FakeERC20Instance } from "../../typechain-truffle";
import { TestAssetBotContext, createTestAssetContext, createTestSecrets } from "../test-utils/create-test-asset-context";
import { loadFixtureCopyVars } from "../test-utils/hardhat-test-helpers";

describe("Toplevel runner and commands integration test", () => {
    const loopDelay = 100; // ms
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerManagementAddress: string;
    const ownerUnderlyingAddress = "owner_underlying_1";
    let ownerWorkAddress: string;
    let userAddress: string;
    const userUnderlyingAddress = "user_underlying_1";
    let chain: MockChain;
    let settings: AssetManagerSettings;
    let secrets: Secrets;
    let timekeeperService: TimeKeeperService;
    let botRunner: AgentBotRunner;
    let agentCommands: AgentBotCommands;
    let userCommands: UserBotCommands;
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

    const xrpChainInfo: TestChainInfo = {
        chainId: SourceId.testXRP,
        name: "Ripple",
        symbol: "XRP",
        decimals: 6,
        amgDecimals: 6,
        startPrice: 0.53,
        blockTime: 2,
        finalizationBlocks: 3,
        underlyingBlocksForPayment: 100,
        lotSize: 10,
        requireEOAProof: false,
    };

    async function waitForEvent(fromBlock: number, maxWaitMs: number, predicate: (event: EvmEvent) => boolean) {
        const sleepTime = 100;
        const eventDecoder = new Web3ContractEventDecoder({ assetManager: context.assetManager });
        for (let t = 0; t < maxWaitMs; t += sleepTime) {
            const toBlock = await web3.eth.getBlockNumber();
            if (fromBlock <= toBlock) {
                const rawEvents = await web3.eth.getPastLogs({ address: context.assetManager.address, fromBlock, toBlock });
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

    before(async () => {
        accounts = await web3.eth.getAccounts();
        ownerManagementAddress = accounts[2];
        ownerWorkAddress = accounts[3];
        userAddress = accounts[4];
    });

    async function initialize() {
        console.log("Creating context...");
        orm = await createTestOrm();
        context = await createTestAssetContext(accounts[0], xrpChainInfo);
        chain = checkedCast(context.blockchainIndexer.chain, MockChain);
        settings = await context.assetManager.getSettings();
        secrets = createTestSecrets(SourceId.testXRP, ownerManagementAddress, ownerWorkAddress, ownerUnderlyingAddress);
        // set work address mapping
        await context.agentOwnerRegistry.setWorkAddress(ownerWorkAddress, { from: ownerManagementAddress });
        // context map
        const contexts = new Map<string, TestAssetBotContext>([[decodedChainId(context.chainInfo.chainId), context]]);
        // timekeeper
        timekeeperService = new TimeKeeperService(contexts, ownerWorkAddress, "auto", 60_000, loopDelay);
        // agent bot runner
        botRunner = new AgentBotRunner(secrets, contexts, orm, loopDelay, testNotifierTransports, timekeeperService);
        // agent bot commands
        const ownerAddressPair = new OwnerAddressPair(ownerManagementAddress, ownerWorkAddress);
        agentCommands = new AgentBotCommands(context, ownerAddressPair, ownerUnderlyingAddress, orm, testNotifierTransports);
        // user bot commands
        const fassetSymbol = await context.fAsset.symbol();
        userCommands = new UserBotCommands(context, fassetSymbol, userAddress, userUnderlyingAddress);
        // currencies
        const usdc = context.stablecoins.usdc as FakeERC20Instance;
        usdcCurrency = await Currencies.erc20(usdc);
        natCurrency = await Currencies.evmNative(context);
        xrpCurrency = Currencies.chain(xrpChainInfo);
        // mint some XRP to owner
        chain.mint(ownerUnderlyingAddress, xrpCurrency.parse("100"));
        chain.mine(chain.finalizationBlocks + 1);  // add enough blocks for finalized block proof to succeed
        // mint some collaterals to owner
        await usdc.mintAmount(ownerWorkAddress, usdcCurrency.parse("1000"));
        // mint some xrp to user
        chain.mint(userUnderlyingAddress, xrpCurrency.parse("1000"));
        //
        return { orm, context, chain, settings, timekeeperService, botRunner, agentCommands, userCommands };
    }

    beforeEach(async () => {
        ({ orm, context, chain, settings, timekeeperService, botRunner, agentCommands, userCommands } = await loadFixtureCopyVars(initialize));
        // start runners in background
        console.log("Starting the bots...");
        timekeeperService.startAll();
        void botRunner.run();
        while (!botRunner.running) await sleep(100);
        chain.enableTimedMining(500);
    });

    afterEach(async () => {
        console.log("Stopping the bots...");
        chain.disableTimedMining();
        botRunner.requestStop();
        while (botRunner.running) await sleep(100);
        await timekeeperService.stopAll();
    });

    it("create agent vault, mint, redeem, and close", async () => {
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
        await waitForEvent(lastBlock, 5000, (ev) => eventIs(ev, context.assetManager, "RedemptionPerformed") && ev.args.agentVault === agentVault);
        // close
        const lastBlock2 = await web3.eth.getBlockNumber();
        await agentCommands.closeVault(agentVault);
        // wait for close process to finish (speed up time to rush through all the timelocks)
        const tm1 = setInterval(() => void time.increase(100), 200);
        try {
            await waitForEvent(lastBlock2, 20000, (ev) => eventIs(ev, context.assetManager, "AgentDestroyed") && ev.args.agentVault === agentVault);
        } finally {
            clearInterval(tm1);
        }
    });

    it("create agent vault, mint, and agent executes mint", async () => {
        const agent = await agentCommands.createAgentVault(newAgentSettings);
        const agentVault = agent.vaultAddress;
        await agentCommands.depositToVault(agentVault, usdcCurrency.parse("100"));
        await agentCommands.buyCollateralPoolTokens(agentVault, natCurrency.parse("100000"));
        await agentCommands.enterAvailableList(agentVault);
        // mint
        const lastEvmBlock = await web3.eth.getBlockNumber();
        await userCommands.mint(agentVault, 10, true);
        chain.mine(300);    // agent will only execute minting once the time for payment expires on underlying chain
        await waitForEvent(lastEvmBlock, 5000, (ev) => eventIs(ev, context.assetManager, "MintingExecuted") && ev.args.agentVault === agentVault);
    });
});
