import { toBNExp, web3 } from "../../src/utils/helpers";
import { WNatContract } from "../../typechain-truffle";

const contract = require("@truffle/contract");

const wnatAbi = require("../../artifacts/flattened/WNat.json");
const WNatRaw = contract(wnatAbi);
console.log(web3.currentProvider?.constructor.name);
console.log((web3.currentProvider as any).host, (web3.currentProvider as any).connected);
WNatRaw.setProvider(web3.currentProvider);
const WNat = WNatRaw as WNatContract;

describe("test initial", async () => {
    let accounts: string[];
    
    before(async () => {
        accounts = await web3.eth.getAccounts();
        web3.eth.defaultAccount = accounts[0];
        // console.log(accounts);
    });
    
    it("create WNat", async () => {
        // const wnat = await WNat.new(accounts[0], "Native", "NAT", { from: accounts[0] });
        const wnat = await WNat.at("0x8858eeb3dfffa017d4bce9801d340d36cf895ccf");
        await wnat.deposit({ from: accounts[1], value: toBNExp(15, 18) });
        await wnat.deposit({ from: accounts[1], value: toBNExp(10, 18) });
        const balance = await wnat.balanceOf(accounts[1]);
        console.log(`Balance = ${balance}`);
    });
    
    it("finish", async () => {
        console.log("done");
    })
});
