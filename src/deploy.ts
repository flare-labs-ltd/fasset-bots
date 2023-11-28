import "dotenv/config"
import { ContractFactory, Wallet, JsonRpcProvider } from 'ethers'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { abi as challengerAbi, bytecode as challengerBytecode } from '../artifacts/contracts/Challenger.sol/Challenger.json'
import { abi as flashLenderAbi, bytecode as flashLenderBytecode } from '../artifacts/contracts/FlashLender.sol/FlashLender.json'


const privateKey = process.env.DEPLOYER_PRIVATE_KEY!
const addresses = require("../addresses.json")[process.env.NETWORK!]
const provider = new JsonRpcProvider(process.env.RPC_URL!)
const signer = new Wallet(privateKey, provider)

async function _deployLiquidatorInterface(abi: any, bytecode: any) {
  const factory = new ContractFactory(abi, bytecode, signer)
  const contract = await factory.deploy(
    addresses.flashLender,
    addresses.blazeSwapRouter
  )
  const address = await contract.getAddress()
  console.log(`contract deployed at ${address}`)
}

async function deployLiquidator() {
  await _deployLiquidatorInterface(liquidatorAbi, liquidatorBytecode)
}
async function deployChallenger() {
  await _deployLiquidatorInterface(challengerAbi, challengerBytecode)
}

async function deployFlashLender() {
  const factory = new ContractFactory(flashLenderAbi, flashLenderBytecode, signer)
  const contract = await factory.deploy(addresses.usdc!)
  const address = await contract.getAddress()
  console.log(`flash lender deployed at ${address}`)
}

deployChallenger()