import { use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { CollateralType } from "../../../src/fasset/AssetManagerTypes";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { TestAssetBotContext, createTestAssetContext } from "../../test-utils/create-test-asset-context";
use(chaiAsPromised);


describe("Create asset context unit tests", () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let collateralTypes: CollateralType[];

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        collateralTypes = await context.assetManager.getCollateralTypes();
    });

    // TODO
});
