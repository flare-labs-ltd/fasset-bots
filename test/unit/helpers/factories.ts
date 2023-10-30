import { ethers } from 'hardhat'
import type {
  BlazeSwapRouter__factory, BlazeSwapManager__factory, BlazeSwapFactory__factory,
  FlashLender__factory, ERC20Mock__factory,
  AssetManagerMock__factory, AgentMock__factory, FakePriceReader__factory,
  Liquidator__factory, Challenger__factory, ChallengerOwned__factory
} from '../../../types'


interface ContractFactories {
  // flash loan
  flashLender: FlashLender__factory
  // blaze-swap
  blazeSwapManager: BlazeSwapManager__factory
  blazeSwapRouter: BlazeSwapRouter__factory
  blazeSwapFactory: BlazeSwapFactory__factory
  // f-asset system
  assetManager: AssetManagerMock__factory
  priceReader: FakePriceReader__factory
  agent: AgentMock__factory
  // tokens
  fAsset: ERC20Mock__factory
  vault: ERC20Mock__factory
  pool: ERC20Mock__factory
  // liquidator
  liquidator: Liquidator__factory
  challenger: Challenger__factory
  challengerOwned: ChallengerOwned__factory
}

export async function getFactories(): Promise<ContractFactories> {
  return {
    flashLender: await ethers.getContractFactory("FlashLender"),
    blazeSwapManager: await ethers.getContractFactory("BlazeSwapManager"),
    blazeSwapFactory: await ethers.getContractFactory("BlazeSwapBaseFactory"),
    blazeSwapRouter: await ethers.getContractFactory("BlazeSwapRouter"),
    assetManager: await ethers.getContractFactory("AssetManagerMock"),
    priceReader: await ethers.getContractFactory("FakePriceReader"),
    agent: await ethers.getContractFactory("AgentMock"),
    fAsset: await ethers.getContractFactory("ERC20Mock"),
    vault: await ethers.getContractFactory("ERC20Mock"),
    pool: await ethers.getContractFactory("ERC20Mock"),
    liquidator: await ethers.getContractFactory("Liquidator"),
    challenger: await ethers.getContractFactory("Challenger"),
    challengerOwned: await ethers.getContractFactory("ChallengerOwned")
  }
}