import { ethers } from 'ethers'
import { IWNat, ILiquidationStrategy, IFtsoRegistry, ILiquidator } from '../typechain';

export interface IAddressesJson {
  liquidator: string
  ftsoRegistry: string
  wNat: string
  fAsset: string // move this to be a key for dexes and agent vaults
  dex: {
    address: string
    tokenA: string 
    // tokenB = fAsset
  }[]
  agentVault: {
    address: string
    class1: string
  }[]
  liqudationStrategy: string // this should be fetched from asset manager but it hard
}

// all CRs are assummed in BIPS
export interface IAgentArbitrageData {
  vaultCollateralToken: string
  poolCollateralToken: string // assume always wNat
  minted: bigint
  vaultCR: {
    current: bigint
    target: bigint
    factor: bigint
  }
  poolCR: {
    current: bigint
    target: bigint
    factor: bigint
  }
  liquidationStatus: number
  maxLiquidation: bigint
}

// think of more appropriate context
export interface IContext {
  provider: ethers.JsonRpcProvider
  addresses: IAddressesJson
  liquidator: ILiquidator
  ftsoRegistry: IFtsoRegistry
  wNat: IWNat
  liquidationStrategy: ILiquidationStrategy
}

///////////////////////////////////////////////////////////////
// smart contract enums - learn how to get them from artifacts

export enum LiquidationPhase {
  NONE,
  CCB,
  LIQUIDATION
}

export enum AgentStatus {
  EMPTY,              // agent does not exist
  NORMAL,
  LIQUIDATION,        // CCB or liquidation due to CR - ends when agent is healthy
  FULL_LIQUIDATION,   // illegal payment liquidation - must liquidate all and close vault
  DESTROYING          // agent announced destroy, cannot mint again
}