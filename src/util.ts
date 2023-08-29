import { ethers } from "ethers"
import { IContext } from "./interface"


type ContractType = 
  | "IAgentVault" 
  | "IBlazeSwap" 
  | "IFAsset" 
  | "IAssetManager" 
  | "IERC20" 
  | "IWNat" 
  | "ILiquidationStrategy" 
  | "IFtsoRegistry"
  | "IERC20Metadata"
  | "ILiquidator"

export const MAX_BIPS = BigInt(10_000)

export function getContract<T>(
  provider: ethers.JsonRpcProvider, address: string, ctype: ContractType
): T {
  const path = "artifacts/" 
    + (ctype === "IERC20") 
    ? "@openzeppelin/token/ERC20/ERC20.sol"
    : (ctype === "IERC20Metadata")
    ? "@openzeppelin/token/ERC20/extensions/ERC20Metadata.sol"
    : `contracts/interface/${ctype}.sol` 
  return new ethers.Contract(address, require(path!).abi, provider) as T
}

// does not account for whhen vault collateral is non 18 decimals or non usd pegged
export async function getAssetPriceInVaultCollateral(
  context: IContext, 
  vaultCollateralSymbol: string, 
  fAssetSymbol: string, 
  fAssetDecimals: bigint
): Promise<bigint> {
  const { _price, _assetPriceUsdDecimals } = await context.ftsoRegistry.getCurrentPriceWithDecimals(fAssetSymbol)
  const exp = fAssetDecimals + BigInt(18) - _assetPriceUsdDecimals
  return _price ** exp
}

///////////////////////////////////////////////////////////////
// bigint math functions

export function mulBips(a: bigint, b: bigint): bigint {
  return (a * b) / MAX_BIPS
}

export function divBips(a: bigint, b: bigint): bigint {
  return (a * MAX_BIPS) / b
}

export function max(a: bigint, b: bigint): bigint {
  return a > b ? a : b
}

export function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

///////////////////////////////////////////////////////////////
// general helper functions

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
