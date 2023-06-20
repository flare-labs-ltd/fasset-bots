import { createTestAssetContext, TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { testChainInfo, testNativeChainInfo } from "../../../test/test-utils/TestChainInfo";
import { disableMccTraceManager } from "../../test-utils/helpers";
import { web3 } from "../../../src/utils/web3";
import rewire from "rewire";
import { CollateralClass, CollateralType } from "../../../src/fasset/AssetManagerTypes";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
import { TrackedStateConfig, TrackedStateConfigChain } from "../../../src/config/BotConfig";
import { createTrackedStateAssetContext } from "../../../src/config/create-asset-context";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";
import { artifacts } from "hardhat";
import { MockChain } from "../../../src/mock/MockChain";
use(chaiAsPromised);
const createAssetContextInternal = rewire("../../../src/config/create-asset-context");
const createStableCoins = createAssetContextInternal.__get__("createStableCoins");
const createFtsos = createAssetContextInternal.__get__("createFtsos");
const findAssetManager = createAssetContextInternal.__get__("findAssetManager");
const getAssetManagerAndController = createAssetContextInternal.__get__("getAssetManagerAndController");

const StateConnector = artifacts.require('StateConnectorMock');

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

    it("Should create ftsos", async () => {
        const ftso = await createFtsos(collateralTypes, context.ftsoRegistry, context.chainInfo.symbol);
        expect(Object.keys(ftso).length).eq(collateralTypes.length + 1);
    });

    it("Should create stable coins", async () => {
        const stableCoinsArray = collateralTypes.filter(token => Number(token.collateralClass) === CollateralClass.CLASS1);
        const stableCoins = await createStableCoins(collateralTypes);
        expect(stableCoinsArray.length).eq(Object.keys(stableCoins).length);
    });

    it("Should not find asset manager - fasset symbol not found", async () => {
        const noSymbol = "NO_SYMBOL";
        await expect(findAssetManager(context.assetManagerController, noSymbol)).to.eventually.be.rejectedWith(`FAsset symbol ${noSymbol} not found`).and.be.an.instanceOf(Error);
    });

    it("Should not get asset manager controller - assetManager or fAssetSymbol required", async () => {
        const chainConfig: TrackedStateConfigChain = {
            chainInfo: {
                chainId: 3,
                name: "Ripple",
                symbol: "XRP",
                decimals: 6,
                amgDecimals: 6,
                requireEOAProof: false,
            },
            chain: context.chain,
            blockChainIndexerClient: context.blockChainIndexerClient
        }
        await expect(getAssetManagerAndController(chainConfig, null, null)).to.eventually.be.rejectedWith(`assetManager or fAssetSymbol required in chain config`).and.be.an.instanceOf(Error);
    });

    it("Should not get asset manager controller - assetManager or fAssetSymbol required", async () => {
        const chainConfig: TrackedStateConfigChain = {
            chainInfo: {
                chainId: 3,
                name: "Ripple",
                symbol: "XRP",
                decimals: 6,
                amgDecimals: 6,
                requireEOAProof: false,
            },
            chain: context.chain,
            blockChainIndexerClient: context.blockChainIndexerClient
        }
        const config: TrackedStateConfig = {
            rpcUrl: "rpcUrl",
            stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainConfig.chainInfo.chainId]: new MockChain() },  "auto"),
            chains: [chainConfig],
            nativeChainInfo: testNativeChainInfo
        }
        await expect(createTrackedStateAssetContext(config, chainConfig)).to.eventually.be.rejectedWith(`Either contractsJsonFile or addressUpdater must be defined`).and.be.an.instanceOf(Error);
    });

});