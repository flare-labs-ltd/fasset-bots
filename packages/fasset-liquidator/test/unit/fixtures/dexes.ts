import { ethers } from "hardhat"
import type { Signer } from "ethers"
import type { ERC20, IUniswapV2Router } from "../../../types"


export async function deployBlazeSwap(
  wNat: ERC20,
  deployer: Signer
): Promise<IUniswapV2Router> {
  const blazeSwapRouterFactory = await ethers.getContractFactory("BlazeSwapRouter")
  const blazeSwapFactoryFactory = await ethers.getContractFactory("BlazeSwapBaseFactory")
  const blazeSwapManagerFactory = await ethers.getContractFactory("BlazeSwapManager")
  const blazeSwapManager = await blazeSwapManagerFactory.deploy(deployer)
  const blazeSwapFactory = await blazeSwapFactoryFactory.deploy(blazeSwapManager)
  // @ts-ignore
  await blazeSwapManager.setFactory(blazeSwapFactory)
  // @ts-ignore
  return blazeSwapRouterFactory.connect(deployer).deploy(blazeSwapFactory, wNat, false)
}

export default async function deployUniswapV2Mock(
    wNat: ERC20,
    deployer: Signer
): Promise<IUniswapV2Router> {
    const uniswapV2MockRouterFactory = await ethers.getContractFactory("UniswapV2RouterMock")
    return uniswapV2MockRouterFactory.connect(deployer).deploy(wNat)
}
