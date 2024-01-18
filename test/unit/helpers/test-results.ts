import path from 'path'
import { GRAPH_POINTS } from '../../constants'
import { writeFileSync, mkdirSync } from 'fs'
import { FixtureUtils } from './fixture'
import type { AssetConfig, EcosystemConfig } from "../fixtures/interface"


const DATA_DIR_PATH = path.join(__dirname, '../../../data')

export interface TestResult {
  ecosystem: EcosystemConfig
  assets: AssetConfig
  paths: [string[], string[]]
  liquidatedFAsset: bigint
}

export interface GraphData {
  X: bigint[]
  Y: bigint[]
  liquidatedVault: bigint
  attainedProfit: bigint
}

export function storeTestResult(
  testResult: TestResult,
  name: string
): void {
  mkdirSync(DATA_DIR_PATH, { recursive: true })
  name = name.replace(/\s/g, "_").replace(/\//g, "")
  const filepath = path.join(DATA_DIR_PATH, name + '.json')
  const graph = graphData(testResult)
  const json = JSON.stringify(
    { ...testResult, graph },
    (_, value) => typeof value === 'bigint' ? value.toString() : value,
    2
  )
  writeFileSync(filepath, json)
}

function graphData(testResult: TestResult): GraphData {
  const { ecosystem, assets, paths, liquidatedFAsset } = testResult
  const [ dex1Path, dex2Path ] = paths
  const utils = new FixtureUtils(assets, ecosystem, [dex1Path, dex2Path])

  const min = BigInt(0)
  const max = utils.maxLiquidatedFAsset()
  const h = (max - min) / BigInt(GRAPH_POINTS)

  const X = []
  const Y = []
  for (let fAsset = min; fAsset <= max; fAsset += h) {
    const vault = utils.vaultSwapInFromFAssetOut(fAsset)
    const profit = utils.arbitrageProfit(vault)
    X.push(vault)
    Y.push(profit)
  }

  const liquidatedVault = utils.vaultSwapInFromFAssetOut(liquidatedFAsset)
  const attainedProfit = utils.arbitrageProfit(liquidatedVault)
  return { X, Y, liquidatedVault, attainedProfit }
}