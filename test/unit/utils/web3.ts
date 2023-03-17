import { readFileSync } from "fs";
import { RunConfig } from "../../../src/config/BotConfig";
import { initWeb3, web3 } from "../../../src/utils/web3";
import { getCoston2AccountsFromEnv } from "../../test-utils/test-actors";
import { COSTON2_RUN_CONFIG_CONTRACTS } from "../../test-utils/test-bot-config";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import rewire from "rewire";
const web3Internal = rewire("../../../src/utils/web3");
const createProvider = web3Internal.__get__("createProvider");

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
        const runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        const accounts = await initWeb3(runConfig.rpcUrl, getCoston2AccountsFromEnv(), 0);
        expect(accounts.length).to.eq(getCoston2AccountsFromEnv().length);
        expect(web3.eth.defaultAccount).to.eq(accounts[0]);
        web3.eth.accounts.wallet.clear();
    });

    it("Should create wallet accounts 2", async () => {
        const runConfig = JSON.parse(readFileSync(COSTON2_RUN_CONFIG_CONTRACTS).toString()) as RunConfig;
        const accounts = await initWeb3(runConfig.rpcUrl, null, null);
        expect(accounts.length).to.eq(0);
        web3.eth.accounts.wallet.clear();
    });

});