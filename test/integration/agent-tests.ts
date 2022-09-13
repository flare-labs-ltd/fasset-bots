import { web3 } from "../../src/utils/helpers";

describe("Persistent agent tests", async () => {
    let accounts: string[];

    before(async () => {
        accounts = await web3.eth.getAccounts();
        web3.eth.defaultAccount = accounts[0];
        // console.log(accounts);
    });
    
    
});
