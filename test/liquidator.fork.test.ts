require('dotenv').config()
import { ethers } from 'ethers'
import { IERC20Metadata } from '../typechain-ethers'
import { EcosystemContracts, getContracts, getAgentContracts } from './helpers/contracts'
import { assetPriceForAgentCr, priceBasedDexReserve, addLiquidity, waitFinalize } from './helpers/contract-utils-ethers'

// usdc balance of deployer (should basically be infinite)
const USDC_BALANCE = BigInt(100_000_000) * ethers.WeiPerEther
// agent to liquidate
const AGENT_ADDRESS = "0x6A3fad5275938549302C26678A487BfC5F9D8ba5"
// deployer is funded with FfakeXRP and CFLR, can mint USDC and set price reader prices
const DEPLOYER_PVK = process.env.DEPLOYER_PRIVATE_KEY!

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545/")

describe("Liquidator", () => {
  let contracts: EcosystemContracts
  let deployer: ethers.Wallet
  let liquidator: ethers.JsonRpcSigner

  // obtains the f-assets's price that results
  // in agent having collateral ratio of crBips
  async function getCollateralForCr(
    collateralKind: "vault" | "pool",
    crBips: number
  ): Promise<bigint> {
    const agentInfo = await contracts.assetManager.getAgentInfo(contracts.agent)
    const totalMintedUBA = agentInfo.mintedUBA + agentInfo.redeemingUBA + agentInfo.reservedUBA
    let collateralWei
    let collateralToken
    let tokenSymbol
    if (collateralKind === "vault") {
      collateralWei = agentInfo.totalVaultCollateralWei
      collateralToken = contracts.usdc
      tokenSymbol = "testUSDC"
    } else {
      collateralWei = agentInfo.totalPoolCollateralNATWei
      collateralToken = contracts.wNat
      tokenSymbol = "CFLR"
    }
    const { 0: collateralFtsoPrice, 2: collateralFtsoDecimals } = await contracts.priceReader.getPrice(tokenSymbol)
    const { 2: fAssetFtsoDecimals } = await contracts.priceReader.getPrice("testXRP")
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
    liquidityProvider: ethers.Signer,
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
    deployer = new ethers.Wallet(DEPLOYER_PVK, provider)
    liquidator = await provider.getSigner(1)
    // mint USDC to deployer and wrap their CFLR (they will provide liquidity to dexes)
    await waitFinalize(provider, deployer, contracts.usdc.connect(deployer).mintAmount(deployer, USDC_BALANCE))
    const availableWNat = await provider.getBalance(deployer) - ethers.WeiPerEther
    await waitFinalize(provider, deployer, contracts.wNat.connect(deployer).deposit({ value: availableWNat })) // wrap CFLR
  })

  it("should liquidate an agent", async () => {
    // we have only those F-Assets and CFLR available
    const availableFAsset = await contracts.fAsset.balanceOf(deployer)
    const availableWNat = await contracts.wNat.balanceOf(deployer)
    // put agent in liquidation by raising xrp price and set cr slightly below ccb
    const assetPrice = await getCollateralForCr("pool", 18_900) // ccb = 19_000, minCr = 20_000, safetyCr = 21_000
    await waitFinalize(provider, deployer, contracts.priceReader.connect(deployer).setPrice("testXRP", assetPrice))
    const agentInfo0 = await contracts.assetManager.getAgentInfo(contracts.agent)
    assert.equal(agentInfo0.poolCollateralRatioBIPS, BigInt(18_900))
    // align dex reserve ratios with the ftso prices
    const { 0: usdcPrice } = await contracts.priceReader.getPrice("testUSDC")
    const { 0: wNatPrice } = await contracts.priceReader.getPrice("CFLR")
    await setDexPairPrice(contracts.fAsset, contracts.usdc, assetPrice, usdcPrice, availableFAsset, deployer, provider)
    await setDexPairPrice(contracts.wNat, contracts.usdc, wNatPrice, usdcPrice, availableWNat, deployer, provider)
    // liquidate agent
    await waitFinalize(provider, liquidator, contracts.assetManager.connect(liquidator).startLiquidation(contracts.agent))
    const agentInfo1 = await contracts.assetManager.getAgentInfo(contracts.agent)
    assert.equal(agentInfo1.status, BigInt(2))
    await waitFinalize(provider, liquidator, contracts.liquidator.connect(liquidator).runArbitrage(contracts.agent))
    // check that agent was fully liquidated and put out of liquidation
    const agentInfo2 = await contracts.assetManager.getAgentInfo(contracts.agent)
    assert.equal(agentInfo2.status, BigInt(0))
    // check that liquidator made a profit
    const liquidatorUsdcBalance = await contracts.usdc.balanceOf(liquidator)
    assert.notEqual(liquidatorUsdcBalance, BigInt(0))
    console.log("liquidator USDC profit:", liquidatorUsdcBalance.toString(), "wei")
    console.log("liquidated:", (agentInfo1.mintedUBA - agentInfo2.mintedUBA).toString(), "UBA")
  })
})