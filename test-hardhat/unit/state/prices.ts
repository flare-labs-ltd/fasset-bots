import { expect } from "chai";
import { AssetManagerSettings } from "../../../src/fasset/AssetManagerTypes";
import { Prices } from "../../../src/state/Prices";
import { sleep, toBN, toBNExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { TestAssetBotContext } from "../../test-utils/create-test-asset-context";
import { createTestContext } from "../../test-utils/helpers";
import { TokenPrice } from "../../../src/state/TokenPrice";

const setMaxTrustedPriceAgeSeconds = 1;
const class1TokenKey = "usdc";
const natFtsoPrice = 100;
const assetFtsoPrice = toBNExp(10, 5);

describe("Prices tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let settings: AssetManagerSettings;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestContext(accounts[0], setMaxTrustedPriceAgeSeconds);
        settings = await context.assetManager.getSettings();
    });



});