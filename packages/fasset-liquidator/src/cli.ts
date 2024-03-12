import { Command, OptionValues } from "commander"
import { JsonRpcProvider, Wallet } from "ethers"
import { storeLatestDeploy } from "./utils"
import { deployLiquidator, deployChallenger, deployUniswapV2, deployFlashLender } from "./deploy"
import { Config, DexManipulator } from "../test/integration/utils/uniswap-v2/dex-manipulator"
import { FTSO_SYMBOLS } from "../test/constants"
import type { Signer } from "ethers"
import type { NetworkAddressesJson } from "../test/integration/utils/interfaces/addresses"

const COSTON_FTSO_SYMBOLS = FTSO_SYMBOLS["coston"]
// target swapping to test xrp (or fake xrp later)
const DEX_POOLS = [
    [COSTON_FTSO_SYMBOLS.TEST_XRP, COSTON_FTSO_SYMBOLS.USDC],
    [COSTON_FTSO_SYMBOLS.TEST_XRP, COSTON_FTSO_SYMBOLS.USDT],
    [COSTON_FTSO_SYMBOLS.TEST_XRP, COSTON_FTSO_SYMBOLS.WETH],
    [COSTON_FTSO_SYMBOLS.TEST_XRP, COSTON_FTSO_SYMBOLS.WNAT]
]

const program = new Command("Liquidator and dex CLI")

// global vars set at config hook
let addresses: NetworkAddressesJson
let provider: JsonRpcProvider
let signer: Signer | undefined

// global configurations
program
    .option("-n, --network <coston>", "network to deploy to", "coston")
    .option("-e, --env-path <env-path>", "path to the file with private key and rpc url", ".env")
    .hook("preAction", (cmd) => {
        const opts = cmd.opts()
        addresses = require("../addresses.json")[opts.network]
        require("dotenv").config({ path: opts.envPath })
        provider = new JsonRpcProvider(process.env.RPC_URL!)
        signer = new Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider)
    })
// commands
program
    .command("deploy").description("deploy contract")
    .argument("<liquidator|challenger|uniswap-v2|flash-lender>", "contract to deploy")
    .action(async (contract: string) => {
        let address: string
        if (contract === "liquidator") {
            address = await deployLiquidator(addresses.flashLender, addresses.uniswapV2, signer!)
        } else if (contract === "challenger") {
            address = await deployChallenger(addresses.flashLender, addresses.uniswapV2, signer!)
        } else if (contract == "uniswap-v2") {
            address = await deployUniswapV2(addresses.WNAT, signer!)
        } else if (contract == "flash-lender") {
            address = await deployFlashLender(signer!)
        } else {
            throw new Error("invalid contract")
        }
        storeLatestDeploy(contract, address, program.opts().network)
    })
program
    .command("coston-beta").description("methods regarding used dex")
    .argument("action <adjust-dex|remove-liquidity>", "action to perform")
    .argument("asset-manager", "address of the asset manager")
    .option("-m, --max-spend-ratio <number>", "maximum ratio of the balance willing to spend in this tx")
    .option("-s, --slippage <bips>", "slippage applied to all of the registered pools (in bips)")
    .option("-v, --volume <bigint>", "amount of token whose swap produces the given slippage")
    .option("--greedy <boolean>", "whether to not distribute spendings evenly across pools (if balance runs out, not all pools will be affected by your action)")
    .action(async (action: string, assetManager: string, _opts: OptionValues) => {
        const opts = { ..._opts, ...program.opts() }
        if (Number(opts.slippage === undefined + opts.volume === undefined) == 1) {
            throw Error("slippage and volume are not well-defined without each other")
        }
        const manipulator = await DexManipulator.create(opts.network, process.env.RPC_URL!, assetManager, process.env.DEX_SIGNER_PRIVATE_KEY!)
        if (action === "adjust-dex") {
            const config: Config = {
                maxRelativeSpendings: opts.maxSpendRatio,
                pools: DEX_POOLS.map(([symbolA, symbolB]) => ({
                    symbolA, symbolB, sync: true, slippage: (opts.slippage !== undefined) ? {
                        amountA: opts.volume, bips: opts.slippage
                    } : undefined
                }))
            }
            await manipulator.adjustDex(config, true)
        } else if (action === "remove-liquidity") {
            await manipulator.removeAllLiquidity({ pools: DEX_POOLS.map(([symbolA, symbolB]) => ({ symbolA, symbolB }))})
        } else if (action === "wrap-wnat") {
            await manipulator.wrapWNat()
        } else if (action === "unwrap-wnat") {
            await manipulator.unwrapWNat()
        }
    })

program.parseAsync(process.argv)