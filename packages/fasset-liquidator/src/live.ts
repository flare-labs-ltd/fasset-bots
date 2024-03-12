// set up the live ecosystem
import "dotenv/config"
import { getBaseContracts } from "../test/integration/utils/contracts"
import type { Signer, JsonRpcProvider } from "ethers"


export async function setUpFlashLender(network: string, provider: JsonRpcProvider, signer: Signer): Promise<void> {
    const contracts = getBaseContracts(network, provider)
    const balance = await contracts.collaterals.usdc.balanceOf(signer)
    await contracts.collaterals.usdc.connect(signer).transfer(contracts.flashLender, balance)
}