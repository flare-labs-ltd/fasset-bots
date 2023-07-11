import { initWeb3, web3 } from "../../../src/utils/web3";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import rewire from "rewire";
import { requireEnv } from "../../../src/utils/helpers";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
const web3Internal = rewire("../../../src/utils/web3");
const createProvider = web3Internal.__get__("createProvider");

const RPC_URL: string = requireEnv('RPC_URL');

describe("web3 unit tests", async () => {

    it("Should create provider", async () => {
        expect(createProvider(null)).to.be.null;
        expect(createProvider("local").host).to.eq("http://127.0.0.1:8545");
        const randomProvider = "http://random"
        expect(createProvider(randomProvider).host).to.eq(randomProvider);
    });

    it("Should not create provider - Invalid provider url", async () => {
        const fn = () => {
            return createProvider("provider");
        };
        expect(fn).to.throw("Invalid provider url");
    });

    it("Should create wallet accounts", async () => {
        const accounts = await initWeb3(RPC_URL, getNativeAccountsFromEnv(), 0);
        expect(accounts.length).to.eq(getNativeAccountsFromEnv().length);
        expect(web3.eth.defaultAccount).to.eq(accounts[0]);
        web3.eth.accounts.wallet.clear();
    });

    it("Should create wallet accounts 2", async () => {
        const accounts = await initWeb3(RPC_URL, null, null);
        expect(accounts.length).to.eq(0);
        web3.eth.accounts.wallet.clear();
    });

});