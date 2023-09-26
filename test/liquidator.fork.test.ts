import { describe, beforeEach } from 'mocha'
import { ethers } from 'ethers'
import { EthersContracts, getContracts } from './helpers/contracts'

const SIGNER_ADDRESS = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const AGENT_ADDRESS = ""

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")

describe("Liquidator", () => {
  let signer: ethers.Wallet
  let contracts: EthersContracts

  beforeEach(async () => {
    signer = new ethers.Wallet(SIGNER_ADDRESS, provider)
    contracts = getContracts("coston")
  })

  it("should liquidate an agent", async () => {
    // setup blazeswap
    const balance = await contracts.usdc.balanceOf(signer.address)
    console.log("balance", balance.toString())
  })
})