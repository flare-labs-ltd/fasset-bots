import { ContractFactory, Signer, JsonRpcProvider } from 'ethers'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { abi as challengerAbi, bytecode as challengerBytecode } from '../artifacts/contracts/Challenger.sol/Challenger.json'


async function deployContract(
  abi: any, bytecode: any, args: any[],
  provider: JsonRpcProvider, signer: Signer
) {

  const factory = new ContractFactory(abi, bytecode, signer)
  const contract = await factory.deploy(...args)
  const address = await contract.getAddress()
  console.log(`contract deployed at ${address}`)
}

export async function deployLiquidator(
  network: string,
  provider: JsonRpcProvider,
  signer: Signer
) {
  const addresses = require("../addresses.json")[network]
  await deployContract(
    liquidatorAbi, liquidatorBytecode,
    [addresses.flashLender, addresses.uniswapV2],
    provider, signer
  )
}

export async function deployChallenger(
  network: string,
  provider: JsonRpcProvider,
  signer: Signer
) {
  const addresses = require("../addresses.json")[network]
  await deployContract(
    challengerAbi, challengerBytecode,
    [addresses.flashLender, addresses.uniswapV2],
    provider, signer
  )
}