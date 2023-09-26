import { ethers } from 'ethers'
import { IWNat, FakeERC20, FlashLender, BlazeSwapRouter, Liquidator } from '../../typechain-ethers'
import { abi as liquidatorAbi } from '../../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { abi as fakeERC20Abi } from '../../artifacts/fasset/contracts/fasset/mock/FakeERC20.sol/FakeERC20.json'
import { abi as wNatAbi } from '../../artifacts/fasset/contracts/fasset/interface/IWNat.sol/IWNat.json'
import { abi as flashLenderAbi } from '../../artifacts/contracts/FlashLender.sol/FlashLender.json'
import { abi as blazeSwapRouterAbi } from '../../artifacts/blazeswap/contracts/periphery/BlazeSwapRouter.sol/BlazeSwapRouter.json'

export interface AddressesJson {
  wNat: string
  usdc: string
  assetManagerController: string
  blazeSwapRouter: string
  flashLender: string
  liquidator: string
}

export interface EthersContracts {
  wNat: IWNat
  usdc: FakeERC20
  blazeSwapRouter: BlazeSwapRouter
  flashLender: FlashLender
  liquidator: Liquidator
  assetManagerController?: any
}

export function getAddresses(network: string): AddressesJson {
  return require(`../../deployments/${network}.json`)
}

export function getContracts(network: string): EthersContracts {
  const address = getAddresses(network)
  return {
    wNat: new ethers.Contract(address.wNat, wNatAbi) as unknown as IWNat,
    usdc: new ethers.Contract(address.usdc, fakeERC20Abi) as unknown as FakeERC20,
    blazeSwapRouter: new ethers.Contract(address.blazeSwapRouter, blazeSwapRouterAbi) as unknown as BlazeSwapRouter,
    flashLender: new ethers.Contract(address.flashLender, flashLenderAbi) as unknown as FlashLender,
    liquidator: new ethers.Contract(address.liquidator, liquidatorAbi) as unknown as Liquidator,
  }
}