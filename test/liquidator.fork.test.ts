require('dotenv').config()
import { describe, beforeEach, afterEach } from 'mocha'
import { ethers } from 'ethers'
import { EcosystemContracts, getContracts, getAgentContracts } from './helpers/contracts'
import { assetPriceForAgentCr, priceBasedDexReserve, addLiquidity, waitFinalize } from './helpers/contract-utils-ethers'
import { IERC20Metadata } from '../typechain-ethers'
import { reset } from '@nomicfoundation/hardhat-network-helpers'

const AGENT_ADDRESS = "0x40AAfBc78185c31154273A1F2bE783b5c48Dde40"
const SIGNER_PVK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const DEPLOYER_PVK = process.env.USDC_OWNER_PRIVATE_KEY! // special privilaged address
const FASSET_HOLDER_PVK = process.env.FASSET_HOLDER_PRIVATE_KEY!

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")

describe("Liquidator", () => {
  let contracts: EcosystemContracts
  let deployer: ethers.Wallet
  let signer: ethers.Wallet

  // obtains the f-assets's price that results
  // in agent having collateral ratio of crBips
  async function getCollateralForCr(
    collateralKind: "vault" | "pool",
    crBips: number
  ): Promise<bigint> {
    const agentInfo = await contracts.assetManager.getAgentInfo(await contracts.agent.getAddress())
    const totalMintedUBA = agentInfo.mintedUBA + agentInfo.redeemingUBA + agentInfo.reservedUBA
    let collateralWei
    let collateralToken
    if (collateralKind === "vault") {
      collateralWei = agentInfo.totalVaultCollateralWei
      collateralToken = contracts.usdc
    } else {
      collateralWei = agentInfo.totalPoolCollateralNATWei
      collateralToken = contracts.wNat
    }
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } =
      await contracts.priceReader.getPrice(await collateralToken.symbol())
    const { 2: fAssetFtsoDecimals } = await contracts.priceReader.getPrice(
      await contracts.fAsset.symbol())
    return assetPriceForAgentCr(
      BigInt(crBips),
      totalMintedUBA,
      collateralWei,
      collateralFtsoPrice,
      collateralFtsoDecimals,
      await collateralToken.decimals(),
      fAssetFtsoDecimals,
      await contracts.fAsset.decimals()
    )
  }

  // set price of tokenA in tokenB
  // both prices in the same currency,
  // e.g. FLR/$, XRP/$
  async function setDexPairPrice(
    tokenA: IERC20Metadata,
    tokenB: IERC20Metadata,
    priceA: bigint,
    priceB: bigint,
    reserveA: bigint,
    liquidityProvider: ethers.Wallet,
    provider: ethers.JsonRpcProvider
  ): Promise<void> {
    const decimalsA = await tokenA.decimals()
    const decimalsB = await tokenB.decimals()
    const reserveB = priceBasedDexReserve(
      priceA,
      priceB,
      decimalsA,
      decimalsB,
      reserveA
    )
    await addLiquidity(
      contracts.blazeSwapRouter,
      tokenA,
      tokenB,
      reserveA,
      reserveB,
      liquidityProvider,
      provider
    )
  }

  beforeEach(async () => {
    const baseContracts = getContracts("coston", provider)
    const agentContracts = await getAgentContracts(AGENT_ADDRESS, provider)
    contracts = { ...baseContracts, ...agentContracts }
    // get relevant signers
    signer = new ethers.Wallet(SIGNER_PVK, provider)
    deployer = new ethers.Wallet(DEPLOYER_PVK, provider)
    // set USDC and WCFLR prices (not yet initialized fakePriceReader)
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setDecimals(await contracts.usdc.symbol(), 5))
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setPrice(await contracts.usdc.symbol(), 100_000))
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setDecimals(await contracts.wNat.symbol(), 5))
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setPrice(await contracts.wNat.symbol(), 1_333))
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setDecimals(await contracts.fAsset.symbol(), 5))
    // let them eat USDC
    const agentInfo = await contracts.assetManager.getAgentInfo(contracts.agent)
    await waitFinalize(provider, deployer, contracts.usdc.connect(deployer).mintAmount(deployer, BigInt(2) * agentInfo.totalVaultCollateralWei))
    // send f-assets to usdcOwner (they will provide liquidity to dex)
    const fAssetHolder = new ethers.Wallet(FASSET_HOLDER_PVK, provider)
    const fAssetBalance = await contracts.fAsset.balanceOf(fAssetHolder)
    await waitFinalize(provider, fAssetHolder, contracts.fAsset.connect(fAssetHolder).transfer(deployer, fAssetBalance))
  })

  // afterEach(reset)

  it("should liquidate an agent", async () => {
    // we have only those f-assets available
    const availableFAsset = await contracts.fAsset.balanceOf(deployer)
    const availableWNat = await provider.getBalance(signer) / BigInt(2)
    await waitFinalize(provider, signer, contracts.wNat.connect(signer).deposit({ value: availableWNat })) // wrap nat
    // put agent in liquidation by raising xrp price and set cr slightly below ccb
    const assetPrice = await getCollateralForCr("vault", 11_000) // ccb = 13_000
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setPrice(await contracts.fAsset.symbol(), assetPrice))
    // align dex reserve ratios with the ftso prices
    const { 0: usdcPrice } = await contracts.priceReader.getPrice(await contracts.usdc.symbol())
    const { 0: wNatPrice } = await contracts.priceReader.getPrice(await contracts.wNat.symbol())
    await setDexPairPrice(contracts.fAsset, contracts.usdc, assetPrice, usdcPrice, availableFAsset, deployer, provider)
    await setDexPairPrice(contracts.wNat, contracts.usdc, wNatPrice, usdcPrice, availableWNat, deployer, provider)
    const agentInfo2 = await contracts.assetManager.getAgentInfo(contracts.agent)
    console.log(agentInfo2)
    // call liquidator
    await waitFinalize(provider, signer, contracts.liquidator.connect(signer).runArbitrage(contracts.agent))
    // check that agent was fully liquidated and put out of liquidation
    const agentInfo = await contracts.assetManager.getAgentInfo(contracts.agent)
    console.log(agentInfo.status)
  })
})