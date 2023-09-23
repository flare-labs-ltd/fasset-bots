import * as addresses from "../contract-addresses-coston.json"
import { ethers, network } from 'hardhat'

import { BlazeSwapRouter } from '../typechain-ethers'

console.log(network)

const USDC_MINTER = "0x88278079a62db08fEb125f270102651BbE8F9984"
const AGENT_ADDRESS = ""

describe("Liquidator", () => {
  beforeEach(async () => {
    // impersonate usdc minter
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [USDC_MINTER],
    })
    const usdcMinter = await ethers.getSigner(USDC_MINTER)
    // get published contracts
    const liquidator = await ethers.getContractAt("Liquidator", addresses.liquidator)
    const flashLender = await ethers.getContractAt("FlashLender", addresses.flashLender)
    const wNat = await ethers.getContractAt("ERC20Mock", addresses.WNAT)
    const usdc = await ethers.getContractAt("ERC20Mock", addresses.USDC)
    const blazeSwap = await ethers.getContractAt("BlazeSwapRouter", addresses.blazeSwapRouter)
    // set up blazeswap

  })
})