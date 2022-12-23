import { IAssetBotContext } from "../../../src/fasset-bots/IAssetBotContext";
import { createTestAssetContext } from "../../utils/test-asset-context";
import { web3 } from "../../../src/utils/web3";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { AMG_NATWEI_PRICE_SCALE, convertAmgToNATWei, convertAmgToUBA, convertLotsToAMG, convertLotsToUBA, convertNATWeiToAMG, convertUBAToAmg, convertUBAToLots, convertUBAToNATWei, lotSize } from "../../../src/fasset/Conversions";
import { expect } from "chai";
import { toBN, toBNExp } from "../../../src/utils/helpers";

describe("Conversions unit tests", async () => {
    let accounts: string[];
    let context: IAssetBotContext;
    let settings: any;
    const amgToNATWeiPrice = toBNExp(2.5, 21);

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

    it("Should convert amg to uba", async () => {
        const amg = 5;
        const uba = Number(convertAmgToUBA(settings, amg));
        const expected = Number(toBN(amg).mul(toBN(settings.assetMintingGranularityUBA)))
        expect(uba).to.eq(expected);
    });

    it("Should convert uba to amg", async () => {
        const uba = 5;
        const amg = Number(convertAmgToUBA(settings, uba));
        const expected = Number(toBN(uba).div(toBN(settings.assetMintingGranularityUBA)));
        expect(amg).to.eq(expected);
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
        const uba = Number(convertLotsToAMG(settings, lots));
        const expected = Number(toBN(lots).mul(toBN(settings.lotSizeAMG)));
        expect(uba).to.eq(expected);
    });

    it("Should convert amg to NAT wei", async () => {
        const amg = 5;
        const NATWei = Number(convertAmgToNATWei(amg, amgToNATWeiPrice));
        const expected = Number(toBN(amg).mul(toBN(amgToNATWeiPrice)).div(AMG_NATWEI_PRICE_SCALE));
        expect(NATWei).to.eq(expected);
    });

    it("Should convert NAT wei to amg", async () => {
        const NATWei = toBNExp(12.5, 12);
        const amg = Number(convertNATWeiToAMG(NATWei,amgToNATWeiPrice));
        const expected = Number(toBN(NATWei).mul(AMG_NATWEI_PRICE_SCALE).div(toBN(amgToNATWeiPrice)));
        expect(amg).to.eq(expected);
    });

    it("Should convert uba to NAT wei", async () => {
        const uba = 5;
        const NATWei = Number(convertUBAToNATWei(settings, uba, amgToNATWeiPrice));
        const expected = Number(convertAmgToNATWei(convertUBAToAmg(settings, uba), amgToNATWeiPrice))
        expect(NATWei).to.eq(expected);
    });

});