import { readFileSync, writeFileSync, existsSync } from 'fs'


const NETWORK_ADDRESS_TEMPLATE = {
    "flash-lender": "",
    "uniswap-v2": "",
    "liquidator": "",
    "challenger": ""
}

export function storeLatestDeploy(contract: string, address: string, network: string) {
    if (!existsSync('deploys.json')) {
        writeFileSync('deploys.json', JSON.stringify({}))
    }
    const addresses = JSON.parse(readFileSync('deploy.log', 'utf8'))
    if (!addresses[network]) {
        addresses[network] = NETWORK_ADDRESS_TEMPLATE
    }
    addresses[network][contract] = address
    writeFileSync('deploy.json', JSON.stringify(addresses))
}