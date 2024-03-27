import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import rewire from "rewire";
import { createChallengerContext } from "../../../src/config";
import { BotConfig, BotFAssetConfig } from "../../../src/config/BotConfig";
import { CollateralType } from "../../../src/fasset/AssetManagerTypes";
import { MockChain } from "../../../src/mock/MockChain";
import { MockStateConnectorClient } from "../../../src/mock/MockStateConnectorClient";
import { MockVerificationApiClient } from "../../../src/mock/MockVerificationApiClient";
import { SourceId } from "../../../src/underlying-chain/SourceId";
import { artifacts, web3 } from "../../../src/utils/web3";
import { testChainInfo, testNativeChainInfo } from "../../../test/test-utils/TestChainInfo";
import { testNotifierTransports } from "../../../test/test-utils/testNotifierTransports";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
use(chaiAsPromised);
const createAssetContextInternal = rewire("../../../src/config/create-asset-context");
const findAssetManager = createAssetContextInternal.__get__("findAssetManager");
const getAssetManagerAndController = createAssetContextInternal.__get__("getAssetManagerAndController");

const StateConnector = artifacts.require("StateConnectorMock");

describe("Create asset context unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let collateralTypes: CollateralType[];

    before(async () => {
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
        const chainId = SourceId.testXRP;
        const chainConfig: BotFAssetConfig = {
            chainInfo: {
                chainId: chainId,
                name: "Ripple",
                symbol: "XRP",
                decimals: 6,
                amgDecimals: 6,
                requireEOAProof: false,
            },
            blockchainIndexerClient: context.blockchainIndexer,
            stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainId]: new MockChain() }, "auto"),
            verificationClient: new MockVerificationApiClient(),
        };
        await expect(getAssetManagerAndController(chainConfig, null, null))
            .to.eventually.be.rejectedWith(`assetManager or fAssetSymbol required in chain config`)
            .and.be.an.instanceOf(Error);
    });

    it("Should not get asset manager controller - contractsJsonFile or addressUpdater required", async () => {
        const chainId = SourceId.testXRP;
        const fAssetConfig: BotFAssetConfig = {
            chainInfo: {
                chainId: chainId,
                name: "Ripple",
                symbol: "XRP",
                decimals: 6,
                amgDecimals: 6,
                requireEOAProof: false,
            },
            blockchainIndexerClient: context.blockchainIndexer,
            stateConnector: new MockStateConnectorClient(await StateConnector.new(), { [chainId]: new MockChain() }, "auto"),
            verificationClient: new MockVerificationApiClient(),
        };
        const config: BotConfig = {
            loopDelay: 1000,
            rpcUrl: "rpcUrl",
            fAssets: [fAssetConfig],
            nativeChainInfo: testNativeChainInfo,
            notifiers: testNotifierTransports,
        };
        await expect(createChallengerContext(config, fAssetConfig))
            .to.eventually.be.rejectedWith(`Either contractsJsonFile or addressUpdater must be defined`)
            .and.be.an.instanceOf(Error);
    });
});
