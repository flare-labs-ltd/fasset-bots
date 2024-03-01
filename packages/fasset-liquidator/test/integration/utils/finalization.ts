import type { ContractTransactionReceipt, ContractTransactionResponse, JsonRpcProvider, Signer } from "ethers"


async function sleep(milliseconds: number) {
    await new Promise((resolve: any) => {
        setTimeout(() => {
            resolve()
        }, milliseconds)
    })
}

export async function waitFinalize(
    provider: JsonRpcProvider,
    signer: Signer,
    prms: Promise<ContractTransactionResponse>
): Promise<ContractTransactionReceipt> {
    const signerAddress = await signer.getAddress()
    const nonce = await provider.getTransactionCount(signer)
    let response
    try {
        response = ((await prms).wait())
    } catch {
        response = await prms
        await sleep(5_000)
    }
    while ((await provider.getTransactionCount(signerAddress)) === nonce) {
        await sleep(100)
    }
    return response as any
}
