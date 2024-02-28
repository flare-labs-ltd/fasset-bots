import { Command, OptionValues } from "commander"
import { JsonRpcProvider, Wallet } from "ethers"
import { storeLatestDeploy } from "./utils"
import { deployLiquidator, deployChallenger, deployUniswapV2, deployFlashLender } from "./deploy"
import { getDexVsFtsoPrices, setUpDexPools, fixDex, removeDexLiquidity } from "./dex"
import { getContracts } from "../test/integration/helpers/contracts"
import type { NetworkAddressesJson } from "../test/integration/helpers/interface"
import type { Signer } from "ethers"


export async function cli(program: Command) {
    // vars set at hook
    let addresses: NetworkAddressesJson
    let provider: JsonRpcProvider
    let signer: Signer | undefined
    // global configurations
    program
        .option("-n, --network <network>", "network to deploy to", "flare")
        .option("-e, --env-path <env-path>", "path to the file with private key and rpc url", ".env")
        .hook("preAction", (cmd) => {
            const opts = cmd.opts()
            if (opts.envPath === undefined) {
                require("dotenv").config({ path: opts.envPath })
                provider = new JsonRpcProvider(process.env.RPC!)
                signer = new Wallet(process.env.PRIVATE_KEY!, provider)
            }
            addresses = require("../addresses.json")[opts.network]
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
                address = await deployUniswapV2(addresses.wNat, signer!)
            } else if (contract == "flash-lender") {
                address = await deployFlashLender(signer!)
            } else {
                throw new Error("invalid contract")
            }
            storeLatestDeploy(contract, address, program.opts().network)
        })
    program
        .command("dex").description("methods regarding used dex")
        .argument("<prices|setup|fix|remove-liquidity>", "action to perform")
        .argument("asset-manager", "address of the asset manager")
        .action(async (action: string, assetManager: string, opts: OptionValues) => {
            const contracts = await getContracts(assetManager, opts.network, opts.provider)
            if (action === "prices") {
                await getDexVsFtsoPrices(contracts)
            } else if (action === "setup") {
                await setUpDexPools(assetManager, opts.network, provider, signer!)
            } else if (action === "fix") {
                await fixDex(assetManager, opts.network, opts.provider, opts.signer)
            } else if (action === "remove-liquidity") {
                await removeDexLiquidity(assetManager, opts.network, opts.provider, opts.signer)
            } else {
                throw new Error("invalid action")
            }
        })
}
