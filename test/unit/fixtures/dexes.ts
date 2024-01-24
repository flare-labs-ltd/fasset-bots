import { ethers } from "hardhat"
import type { Signer } from "ethers"
import type { ERC20, IUniswapV2Router } from "../../../types"


export default async function deployBlazeSwap(
  wNat: ERC20,
  deployer: Signer
): Promise<IUniswapV2Router> {
  const blazeSwapRouterFactory = await ethers.getContractFactory("BlazeSwapRouter")
  const blazeSwapFactoryFactory = await ethers.getContractFactory("BlazeSwapBaseFactory")
  const blazeSwapManagerFactory = await ethers.getContractFactory("BlazeSwapManager")
  const blazeSwapManager = await blazeSwapManagerFactory.deploy(deployer)
  const blazeSwapFactory = await blazeSwapFactoryFactory.deploy(blazeSwapManager)
  await blazeSwapManager.setFactory(blazeSwapFactory)
  return blazeSwapRouterFactory.deploy(blazeSwapFactory, wNat, false)
}