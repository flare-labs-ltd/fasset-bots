import { IAssetAgentBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { createTestAssetContext } from "../../test-utils/create-test-asset-context";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/test-utils/TestChainInfo";
import { AMG_TOKENWEI_PRICE_SCALE, convertAMGToLots, convertAmgToTokenWei, convertAmgToUBA, convertLotsToAMG, convertLotsToUBA, convertTokenWeiToAMG, convertTokenWeiToUBA, convertUBAToAmg, convertUBAToLots, convertUBAToTokenWei, lotSize } from "../../../src/fasset/Conversions";
import { expect } from "chai";
import { toBN, toBNExp } from "../../../src/utils/helpers";

describe("Conversions unit tests", async () => {
    let accounts: string[];
    let context: IAssetAgentBotContext;
    let settings: any;
    const amgToTokenWeiPrice = toBNExp(2.5, 21);

    before(async () => {
        accounts = await web3.eth.getAccounts();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        settings = await context.assetManager.getSettings();
    });

    it("Should return lotSize", async () => {
        const lotSizeFun = Number(lotSize(settings));
        const expected = Number(toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA)))
        expect(lotSizeFun).to.eq(expected);
    });

    it("Should convert uba to lots", async () => {
        const uba = lotSize(settings).muln(5);
        const lots = Number(convertUBAToLots(settings, uba));
        const expected = Number(toBN(uba).div(lotSize(settings)));
        expect(lots).to.eq(expected);
    });

    it("Should convert lots to uba", async () => {
        const lots = 5;
        const uba = Number(convertLotsToUBA(settings, lots));
        const expected = Number(toBN(lots).mul(lotSize(settings)));
        expect(uba).to.eq(expected);
    });

    it("Should convert lots to amg", async () => {
        const lots = 5;
        const amg = Number(convertLotsToAMG(settings, lots));
        const expected = Number(toBN(lots).mul(toBN(settings.lotSizeAMG)));
        expect(amg).to.eq(expected);
    });

    it("Should convert amg to uba", async () => {
        const amg = 5;
        const uba = Number(convertAmgToUBA(settings, amg));
        const expected = Number(toBN(amg).mul(toBN(settings.assetMintingGranularityUBA)))
        expect(uba).to.eq(expected);
    });

    it("Should convert amg to lots", async () => {
        const amg = 5;
        const lots = Number(convertAMGToLots(settings, amg));
        const expected = Number(toBN(amg).div(toBN(settings.lotSizeAMG)));
        expect(lots).to.eq(expected);
    });

    it("Should convert amg to uba", async () => {
        const uba = 5;
        const amg = Number(convertAmgToUBA(settings, uba));
        const expected = Number(toBN(uba).div(toBN(settings.assetMintingGranularityUBA)));
        expect(amg).to.eq(expected);
    });

    it("Should convert uba to amg", async () => {
        const uba = 5;
        const amg = Number(convertUBAToAmg(settings, uba));
        const expected = Number(toBN(amg).mul(toBN(settings.assetMintingGranularityUBA)));
        expect(amg).to.eq(expected);
    });

    it("Should convert token wei to amg", async () => {
        const valNATWei = toBNExp(12.5, 12);
        const amg = Number(convertTokenWeiToAMG(valNATWei, amgToTokenWeiPrice));
        const expected = Number(toBN(valNATWei).mul(AMG_TOKENWEI_PRICE_SCALE).div(toBN(amgToTokenWeiPrice)));
        expect(amg).to.eq(expected);
    });

    it("Should convert amg to token wei", async () => {
        const amg = toBNExp(12.5, 12);
        const tokenWei = Number(convertAmgToTokenWei(amg, amgToTokenWeiPrice));
        const expected = Number(toBN(amg).mul(toBN(amgToTokenWeiPrice)).div(AMG_TOKENWEI_PRICE_SCALE));
        expect(tokenWei).to.eq(expected);
    });

    it("Should convert uba to token wei", async () => {
        const uba = 5;
        const tokenWei = Number(convertUBAToTokenWei(settings, uba, amgToTokenWeiPrice));
        const expected = Number(convertAmgToTokenWei(convertUBAToAmg(settings, uba), amgToTokenWeiPrice))
        expect(tokenWei).to.eq(expected);
    });

    it("Should convert token wei to uba", async () => {
        const tokenWei = toBNExp(12.5, 12);
        const uba = Number(convertTokenWeiToUBA(settings, tokenWei, amgToTokenWeiPrice));
        const expected = Number(convertAmgToUBA(settings, convertTokenWeiToAMG(tokenWei, amgToTokenWeiPrice)));
        expect(uba).to.eq(expected);
    });

});