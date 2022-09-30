import { initWeb3 } from "../../src/utils/web3";

describe("Persistent agent tests", async () => {
    let accounts: string[];

    before(async () => {
        accounts = await initWeb3('local');
    });
    
    
});
