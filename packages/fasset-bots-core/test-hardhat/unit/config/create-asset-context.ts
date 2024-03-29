import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import rewire from "rewire";
import { CollateralType } from "../../../src/fasset/AssetManagerTypes";
import { artifacts, web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
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
});
