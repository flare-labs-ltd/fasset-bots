import { Command, OptionValues } from "commander"
import { JsonRpcProvider, Wallet } from "ethers"
import { deployLiquidator, deployChallenger } from "./deploy"
import { getDexVsFtsoPrices, fixDex, setUpDex, removeDexLiquidity, setUpFlashLender } from "./dex"


export async function cli(program: Command) {
  // global configurations
  program
    .option("-n, --network <network>", "network to deploy to", "flare")
    .option("-e, --env-path <env-path>", "path to the file with private key and rpc url", ".env")
    .hook("preAction", (cmd) => {
      const opts = cmd.opts()
      if (opts.envPath !== undefined) {
        require("dotenv").config({ path: opts.envPath })
        opts.provider = new JsonRpcProvider(process.env.RPC!)
        opts.signer = new Wallet(process.env.PRIVATE_KEY!, opts.provider)
      }
    })
  program
    .command("deploy").description("deploy contract")
    .argument("<liquidator|challenger", "contract to deploy")
    .action(async (contract: string, opts: OptionValues) => {
      if (contract === "liquidator") {
        await deployLiquidator(opts.network, opts.provider, opts.signer)
      } else if (contract === "challenger") {
        await deployChallenger(opts.network, opts.provider, opts.signer)
      } else {
        throw new Error("invalid contract")
      }
    })
  program
    .command("dex").description("set up dex")
}