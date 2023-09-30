require('dotenv').config()
import { ContractFactory, Wallet, JsonRpcProvider } from 'ethers'
import { abi as liquidatorAbi, bytecode as liquidatorBytecode } from '../artifacts/contracts/Liquidator.sol/Liquidator.json'
import { abi as flashLenderAbi, bytecode as flashLenderBytecode } from '../artifacts/contracts/FlashLender.sol/FlashLender.json'


const privateKey = process.env.DEPLOYER_PRIVATE_KEY!
const addresses = require(`../${process.env.CONTRACT_ADDRESSES!}`)
const provider = new JsonRpcProvider(process.env.RPC_URL!)
const signer = new Wallet(privateKey, provider)

async function deployLiquidator() {
  const factory = new ContractFactory(liquidatorAbi, liquidatorBytecode, signer)
  const contract = await factory.deploy(
    addresses.wNat,
    addresses.flashLender,
    addresses.blazeSwapRouter
  )
  const address = await contract.getAddress()
  console.log(`liquidator deployed at ${address}`)
}

async function deployFlashLender() {
  const factory = new ContractFactory(flashLenderAbi, flashLenderBytecode, signer)
  const contract = await factory.deploy(addresses.usdc!)
  const address = await contract.getAddress()
  console.log(`flash lender deployed at ${address}`)
}

deployLiquidator()