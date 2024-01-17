import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import type { AssetConfig, EcosystemConfig } from "../fixtures/interface"


const DIR_PATH = '../../../data'

interface TestFixture {
  ecosystem: EcosystemConfig
  assets: AssetConfig
  path: string
}

interface TestResult {
  testFixture: TestFixture
  liquidatedVault: bigint
}

function storeFixture(fixture: TestFixture): void {
  mkdirSync(DIR_PATH, { recursive: true })
  const configPath = DIR_PATH + '/' + fixture.ecosystem.name + '.json'
  const configString = JSON.stringify(context, null, 2)
  writeFileSync(configPath, configString)
}

function loadFixture(name: string): TestFixture {
  const path = DIR_PATH + '/' + name + '.json'
  const fixtureString = readFileSync(path, 'utf8')
  return JSON.parse(fixtureString)
}

function prepareDrawData(name: string) {
  const { ecosystem, assets } = loadFixture(name)

}