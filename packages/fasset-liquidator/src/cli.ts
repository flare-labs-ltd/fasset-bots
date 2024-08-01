import { Command, OptionValues } from "commander"
import { JsonRpcProvider, Wallet } from "ethers"
import { storeLatestDeploy } from "./utils"
import { deployLiquidator, deployChallenger, deployUniswapV2, deployFlashLender, deployUniswapV2Mock } from "./deploy"
import { Config, DexFtsoPriceSyncer } from "../test/integration/utils/uniswap-v2/dex-manipulator"
import { ASSET_MANAGER_ADDRESSES, DEX_POOLS } from "../test/config"
import type { Signer } from "ethers"
import type { NetworkAddressesJson } from "../test/integration/utils/interfaces/addresses"


const program = new Command("Liquidator and dex CLI")

// global vars set at config hook
let addresses: NetworkAddressesJson
let provider: JsonRpcProvider
let signer: Signer | undefined

// global configurations
program
    .option("-n, --network <coston|flare>", "network to deploy to", "coston")
    .option("-e, --env-path <env-path>", "path to the file with private key and rpc url", ".env")
    .hook("preAction", (cmd) => {
        const opts = cmd.opts()
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        addresses = require("../addresses.json")[opts.network]
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require("dotenv").config({ path: opts.envPath })
        provider = new JsonRpcProvider(process.env.RPC_URL!)
        signer = new Wallet(process.env.PRIVATE_KEY!, provider)
    })
// commands
program
    .command("deploy").description("deploy contract")
    .argument("<liquidator|challenger|uniswap-v2|flash-lender|uniswap-v2-mock>", "contract to deploy")
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
        } else if (contract == "uniswap-v2-mock") {
            address = await deployUniswapV2Mock(addresses.uniswapV2, signer!)
        } else {
            throw new Error("invalid contract")
        }
        storeLatestDeploy(contract, address, program.opts().network)
    })
program
    .command("coston-beta").description("methods regarding used dex")
    .argument("action <sync-dex|remove-liquidity|wrap-wnat|unwrap-wnat|run-dex-sync-bot>", "action to perform")
    .option("-f, --f-asset <fTestXRP>", "address of the relevant f-asset", "FTestXRP")
    .option("-m, --max-spend-ratio <number>", "maximum ratio of the balance willing to spend in this tx")
    .option("--greedy <boolean>", "whether to not distribute spendings evenly across pools (if balance runs out, not all pools will be affected by your action)", false)
    .action(async (action: string, _opts: OptionValues) => {
        const opts = { ..._opts, ...program.opts() }
        const assetManager = getAssetManagerAddress(opts.network, opts.fAsset)
        const liquidityPools = getDexPools(opts.network, opts.fAsset)
        const manipulator = await DexFtsoPriceSyncer.create(opts.network, process.env.RPC_URL!, assetManager, process.env.PRIVATE_KEY!)
        if (action === "sync-dex" || action === "run-dex-sync-bot") {
            if (Number(opts.slippage === undefined + opts.volume === undefined) == 1) {
                throw Error("slippage and volume are not well-defined without each other")
            }
            const config: Config = {
                maxRelativeSpendings: opts.maxSpendRatio,
                pools: liquidityPools.map(([symbolA, symbolB]) => ({ symbolA, symbolB }))
            }
            if (action === "sync-dex") {
                await manipulator.syncDex(config, opts.greedy)
            } else {
                await manipulator.run(config, opts.greedy)
            }
        } else if (action === "remove-liquidity") {
            await manipulator.removeAllLiquidity(liquidityPools.map(([symbolA, symbolB]) => ({ symbolA, symbolB })))
        } else if (action === "wrap-wnat") {
            await manipulator.wrapWNat()
        } else if (action === "unwrap-wnat") {
            await manipulator.unwrapWNat()
        }
    })

program.parseAsync(process.argv).catch((error) => {
    console.error("Uncaught error in liquidator", error);
    process.exit(1);
});

function getAssetManagerAddress(network: string, fAsset: string): string {
    const networkAssetManager = ASSET_MANAGER_ADDRESSES[network as keyof typeof ASSET_MANAGER_ADDRESSES]
    return networkAssetManager[fAsset as keyof typeof networkAssetManager]
}

function getDexPools(network: string, fAsset: string): [string, string][] {
    const networkPools = DEX_POOLS[network as keyof typeof DEX_POOLS]
    return networkPools[fAsset as keyof typeof networkPools] as [string, string][]
}
