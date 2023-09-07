const BlazeSwapPair = require('../artifacts/blazeswap/contracts/core/BlazeSwapPair.sol/BlazeSwapPair.json')
import { keccak256 } from '@ethersproject/keccak256'

// in hardhat the truffle artifacts are not the same as in artifacs/ folder,
// so don't yet know where to change the config to match blaze swap pair bytecode hash

describe("Test blazeswap hardcoded hash", () => {
  it("should match the hardcoded hash with the generated one", async () => {
    const hash = keccak256(BlazeSwapPair.bytecode)
    console.log(hash)
    expect(hash).to.equal('0xbf4c1c435583a2bb8d763765a34a46e376071c3b3d80e5bbac0950aeecdf31cb')
  });
});