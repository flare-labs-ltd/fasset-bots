import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo, testNativeChainInfo } from "../../../test/test-utils/TestChainInfo";
import { disableMccTraceManager } from "../../test-utils/helpers";
import { artifacts, web3 } from "../../../src/utils/web3";
import rewire from "rewire";
import { CollateralClass, CollateralType } from "../../../src/fasset/AssetManagerTypes";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";
import { MockChain } from "../../../src/mock/MockChain";
import { BotFAssetConfig, BotConfig } from "../../../src/config/BotConfig";
import { createActorAssetContext } from "../../../src/config/create-asset-context";
import { ActorBaseKind } from "../../../src/fasset-bots/ActorBase";
use(chaiAsPromised);
const createAssetContextInternal = rewire("../../../src/config/create-asset-context");
const findAssetManager = createAssetContextInternal.__get__("findAssetManager");
const getAssetManagerAndController = createAssetContextInternal.__get__("getAssetManagerAndController");

const StateConnector = artifacts.require("StateConnectorMock");

describe("Create asset context unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let collateralTypes: CollateralType[];

    before(async () => {
        disableMccTraceManager();
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        collateralTypes = await context.assetManager.getCollateralTypes();
    });

    it("Should not find asset manager - fasset symbol not found", async () => {
        const noSymbol = "NO_SYMBOL";
        await expect(findAssetManager(context.assetManagerController, noSymbol))
            .to.eventually.be.rejectedWith(`FAsset symbol ${noSymbol} not found`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not get asset manager controller - assetManager or fAssetSymbol required", async () => {
        const chainId = 3;
        const chainConfig: BotFAssetConfig = {
            chainInfo: {
                chainId: chainId,
                name: "Ripple",
                symbol: "XRP",
                decimals: 6,
                amgDecimals: 6,
                requireEOAProof: false,
                finalizationBlocks: 6,
            },
            blockchainIndexerClient: context.blockchainIndexer,
            stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainId]: new MockChain() }, "auto"),
        };
        await expect(getAssetManagerAndController(chainConfig, null, null))
            .to.eventually.be.rejectedWith(`assetManager or fAssetSymbol required in chain config`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not get asset manager controller - contractsJsonFile or addressUpdater required", async () => {
        const chainId = 3;
        const fAssetConfig: BotFAssetConfig = {
            chainInfo: {
                chainId: chainId,
                name: "Ripple",
                symbol: "XRP",
                decimals: 6,
                amgDecimals: 6,
                requireEOAProof: false,
                finalizationBlocks: 6,
            },
            blockchainIndexerClient: context.blockchainIndexer,
            stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainId]: new MockChain() }, "auto"),
        };
        const config: BotConfig = {
            loopDelay: 1000,
            rpcUrl: "rpcUrl",
            fAssets: [fAssetConfig],
            nativeChainInfo: testNativeChainInfo,
        };
        await expect(createActorAssetContext(config, fAssetConfig, ActorBaseKind.CHALLENGER))
            .to.eventually.be.rejectedWith(`Either contractsJsonFile or addressUpdater must be defined`)
            .and.be.an.instanceOf(Error);
    });
});
