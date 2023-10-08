import { ethers } from 'ethers'


////////////////////////////////////////////////////////////////////////////
// pure ethers specific

async function sleep(milliseconds: number) {
  await new Promise((resolve: any) => {
    setTimeout(() => {
      resolve()
    }, milliseconds)
  })
}

export async function waitFinalize(
  provider: ethers.JsonRpcProvider,
  signer: ethers.Signer,
  prms: Promise<ethers.ContractTransactionResponse>,
  nonceIncrease: number = 1
): Promise<ethers.ContractTransactionReceipt> {
  const signerAddress = await signer.getAddress()
  const nonce = await provider.getTransactionCount(signer)
  const res = await (await prms).wait()
  while ((await provider.getTransactionCount(signerAddress)) < nonce + nonceIncrease) {
    await sleep(100)
  }
  return res!
}