import { ContractFactory } from 'ethers'
import { waitFinalize } from './finalization'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../../../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { IIAssetManager__factory, IERC20Metadata__factory, FakePriceReader__factory, IIAgentVault__factory, FakeERC20__factory, IWNat__factory, IUniswapV2Router__factory, IERC3156FlashLender__factory } from '../../../types'
import type { JsonRpcProvider, Signer } from 'ethers'
import type { NetworkAddressesJson, AddressesJson } from './interfaces/addresses'
import type { BaseContracts, FAssetContracts, Contracts } from './interfaces/contracts'
import type { IUniswapV2Router, IERC3156FlashLender, Liquidator } from '../../../types'


export function getAddresses(network: string): NetworkAddressesJson {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const addresses = require(`../../../addresses.json`) as AddressesJson
    return addresses[network]
}

export function getBaseContracts(network: string, provider: JsonRpcProvider): BaseContracts {
    const addresses = getAddresses(network)
    const contracts: BaseContracts = {
        collaterals: {},
        wNat: IWNat__factory.connect(addresses.WNAT, provider),
        uniswapV2: IUniswapV2Router__factory.connect(addresses.uniswapV2, provider),
        flashLender: IERC3156FlashLender__factory.connect(addresses.flashLender, provider)
    }
    for (const tokenName of Object.keys(addresses.collaterals)) {
        contracts.collaterals[tokenName] = FakeERC20__factory.connect(addresses.collaterals[tokenName], provider)
    }
    return contracts
}

export async function getFAssetContracts(
    assetManagerAddress: string,
    provider: JsonRpcProvider
): Promise<FAssetContracts> {
    const assetManager = IIAssetManager__factory.connect(assetManagerAddress, provider)
    const settings = await assetManager.getSettings()
    const fAsset = IERC20Metadata__factory.connect(settings.fAsset, provider)
    const priceReader = FakePriceReader__factory.connect(settings.priceReader, provider)
    return { assetManager, fAsset, priceReader }
}

export async function getContracts(
    assetManagerAddress: string,
    network: string,
    provider: JsonRpcProvider
): Promise<Contracts> {
    const baseContracts = getBaseContracts(network, provider)
    const fAssetContracts = await getFAssetContracts(assetManagerAddress, provider)
    return { ...baseContracts, ...fAssetContracts }
}

export async function getAssetManagerFromAgent(
    agentAddress: string,
    provider: JsonRpcProvider
): Promise<string> {
    const agent = IIAgentVault__factory.connect(agentAddress, provider)
    return agent.assetManager()
}

export async function deployLiquidator(
    flashLender: IERC3156FlashLender,
    uniswapV2: IUniswapV2Router,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<Liquidator> {
    const factory = new ContractFactory(liquidatorAbi, liquidatorBytecode, signer)
    // @ts-expect-error deploy not returning a transaction response
    return waitFinalize(provider, signer, factory.connect(signer).deploy(flashLender, uniswapV2)) as any
}
