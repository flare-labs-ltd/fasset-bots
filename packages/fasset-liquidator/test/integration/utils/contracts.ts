import { Contract, ContractFactory } from 'ethers'
import { waitFinalize } from './finalization'
import { abi as fakeERC20Abi } from '../../../artifacts/fasset/contracts/fasset/mock/FakeERC20.sol/FakeERC20.json'
import { abi as wNatAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IWNat.sol/IWNat.json'
import { abi as agentAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAgentVault.sol/IIAgentVault.json'
import { abi as assetManagerAbi } from '../../../artifacts/fasset/contracts/fasset/interface/IIAssetManager.sol/IIAssetManager.json'
import { abi as erc20MetadataAbi } from '../../../artifacts/@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol/IERC20Metadata.json'
import { abi as flashLenderAbi } from '../../../artifacts/@openzeppelin/contracts/interfaces/IERC3156FlashLender.sol/IERC3156FlashLender.json'
import { abi as uniswapV2RouterAbi } from '../../../artifacts/contracts/interface/IUniswapV2/IUniswapV2Router.sol/IUniswapV2Router.json'
import { abi as fakePriceReaderAbi } from '../../../artifacts/fasset/contracts/fasset/mock/FakePriceReader.sol/FakePriceReader.json'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../../../artifacts/contracts/Liquidator.sol/Liquidator.json'
import type { JsonRpcProvider, Signer } from 'ethers'
import type { NetworkAddressesJson, AddressesJson } from './interfaces/addresses'
import type { BaseContracts, FAssetContracts, Contracts } from './interfaces/contracts'
import type { IUniswapV2Router, IERC3156FlashLender, IIAgentVault, Liquidator } from '../../../types'


export function getAddresses(network: string): NetworkAddressesJson {
    const addresses = require(`../../../addresses.json`) as AddressesJson
    return addresses[network]
}

export function getBaseContracts(network: string, provider: JsonRpcProvider): BaseContracts {
    const addresses = getAddresses(network)
    const contracts: BaseContracts = {
        collaterals: {},
        wNat: new Contract(addresses.WNAT, wNatAbi, provider) as any,
        uniswapV2: new Contract(addresses.uniswapV2, uniswapV2RouterAbi, provider) as any,
        flashLender: new Contract(addresses.flashLender, flashLenderAbi, provider) as any
    }
    for (const tokenName of Object.keys(addresses.collaterals)) {
        contracts.collaterals[tokenName] = new Contract(addresses.collaterals[tokenName], fakeERC20Abi, provider) as any
    }
    return contracts
}

export async function getFAssetContracts(
    assetManagerAddress: string,
    provider: JsonRpcProvider
): Promise<FAssetContracts> {
    const assetManager = new Contract(assetManagerAddress, assetManagerAbi, provider) as any
    const settings = await assetManager.getSettings()
    const fAsset = new Contract(settings.fAsset, erc20MetadataAbi, provider) as any
    const priceReader = new Contract(settings.priceReader, fakePriceReaderAbi, provider) as any
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
    const agent: IIAgentVault = new Contract(agentAddress, agentAbi, provider) as any
    return agent.assetManager()
}

export async function deployLiquidator(
    flashLender: IERC3156FlashLender,
    uniswapV2: IUniswapV2Router,
    signer: Signer,
    provider: JsonRpcProvider
): Promise<Liquidator> {
    const factory = new ContractFactory(liquidatorAbi, liquidatorBytecode, signer)
    // @ts-ignore deploy not returning a transaction response
    return waitFinalize(provider, signer, factory.connect(signer).deploy(flashLender, uniswapV2)) as any
}