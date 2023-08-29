import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { ethers } from "ethers"
import { IWNat, ILiquidationStrategy, ILiquidator } from '../typechain';
import { IAddressesJson, IContext } from './interface';
import { getContract } from './util'

dotenv.config()

export const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
export const addresses = JSON.parse(fs.readFileSync(process.env.CONTRACTS!, 'utf-8'))

export function getContext(
  provider: ethers.JsonRpcProvider, 
  addresses: IAddressesJson
): IContext {
  return {
    provider: provider, 
    addresses: addresses,
    // assume ftso registry will not change
    ftsoRegistry: getContract(provider, addresses.ftsoRegistry, "IFtsoRegistry"),
    // wrapped native address can change, but in that case flare is dead anyway
    wNat: getContract<IWNat>(provider, addresses.wNat, "IWNat"),
    // liquidation strategy is specific to asset manager, but don't know how to get the address
    liquidationStrategy: getContract<ILiquidationStrategy>(
      provider, addresses.liqudationStrategy, "ILiquidationStrategy"),
    liquidator: getContract<ILiquidator>(provider, addresses.liquidator, "ILiquidator")
  }
}