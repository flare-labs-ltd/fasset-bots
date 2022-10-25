import { artifacts } from "../../src/utils/artifacts";
import { toBNExp } from "../../src/utils/helpers";
import { initTestWeb3 } from "../../src/utils/web3";

const WNat = artifacts.require('WNat');

describe("PeristentAgent tests", async () => {
    let accounts: string[];

    before(async () => {
        accounts = await initTestWeb3('local');
    });

    // TODO: build config
    
    it("create persistent agent", async () => {
        const wnat = await WNat.new(accounts[0], "Native", "NAT");
        // const wnat = await WNat.at("0x8858eeb3dfffa017d4bce9801d340d36cf895ccf");
        await wnat.deposit({ from: accounts[1], value: toBNExp(15, 18) });
        await wnat.deposit({ from: accounts[1], value: toBNExp(10, 18) });
        const balance = await wnat.balanceOf(accounts[1]);
        console.log(`Balance = ${balance}`);
    });
});
