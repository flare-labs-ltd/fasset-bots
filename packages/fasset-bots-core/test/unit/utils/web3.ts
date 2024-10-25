import { authenticatedHttpProvider, initWeb3, web3 } from "../../../src/utils/web3";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import rewire from "rewire";
import { getNativeAccounts } from "../../test-utils/test-helpers";
import { COSTON_RPC, TEST_SECRETS } from "../../test-utils/test-bot-config";
const web3Internal = rewire("../../../src/utils/web3");
const createProvider = web3Internal.__get__("createProvider");
import { HttpProvider } from "web3-core";
import { Secrets } from "../../../src/config";

describe("web3 unit tests", () => {
    it("Should create provider", async () => {
        expect(createProvider(null)).to.be.null;
        expect(createProvider("local").host).to.eq("http://127.0.0.1:8545");
        const randomProvider = "http://random";
        expect(createProvider(randomProvider).host).to.eq(randomProvider);
    });

    it("Should not create provider - Invalid provider url", async () => {
        const fn = () => {
            return createProvider("provider");
        };
        expect(fn).to.throw("Invalid provider url");
    });

    it("Should create wallet accounts", async () => {
        const secrets = await Secrets.load(TEST_SECRETS);
        const envPrivateKeys = getNativeAccounts(secrets);
        const accounts = await initWeb3(COSTON_RPC, envPrivateKeys, 0);
        const uniqueEnvAccounts = new Set(envPrivateKeys);
        expect(accounts.length).to.eq(uniqueEnvAccounts.size);
        expect(web3.eth.defaultAccount).to.eq(accounts[0]);
        web3.eth.accounts.wallet.clear();
    });

    it("Should create wallet accounts 2", async () => {
        const accounts = await initWeb3(COSTON_RPC, null, null);
        expect(accounts.length).to.eq(0);
        web3.eth.accounts.wallet.clear();
    });

    it("Should create http provider", async () => {
        const prov: HttpProvider = authenticatedHttpProvider(COSTON_RPC) as HttpProvider;
        expect(prov.host).to.eq(COSTON_RPC);
    });
});
