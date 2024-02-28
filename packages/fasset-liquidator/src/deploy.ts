import { ContractFactory, Signer, AddressLike } from 'ethers'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { abi as challengerAbi, bytecode as challengerBytecode } from '../artifacts/contracts/Challenger.sol/Challenger.json'
import { abi as flashLenderAbi, bytecode as flashLenderBytecode } from '../artifacts/contracts/mock/FlashLender.sol/FlashLender.json'
import { abi as uniswapV2Abi, bytecode as uniswapV2Bytecode } from '../artifacts/contracts/mock/UniswapV2/UniswapV2RouterMock.sol/UniswapV2RouterMock.json'


async function deployContract(abi: any, bytecode: any, args: any[], signer: Signer): Promise<string> {
    const factory = new ContractFactory(abi, bytecode, signer)
    const contract = await factory.deploy(...args)
    return contract.getAddress()
}

export async function deployLiquidator(flashLender: AddressLike, uniswapV2: AddressLike, signer: Signer): Promise<string> {
    return deployContract(liquidatorAbi, liquidatorBytecode, [flashLender, uniswapV2], signer)
}

export async function deployChallenger(flashLender: AddressLike, uniswapV2: AddressLike, signer: Signer): Promise<string> {
    return deployContract(challengerAbi, challengerBytecode, [flashLender, uniswapV2], signer)
}

export async function deployFlashLender(signer: Signer): Promise<string> {
    return deployContract(flashLenderAbi, flashLenderBytecode, [], signer)
}

export async function deployUniswapV2(wNat: AddressLike, signer: Signer): Promise<string> {
    return deployContract(uniswapV2Abi, uniswapV2Bytecode, [wNat], signer)
}