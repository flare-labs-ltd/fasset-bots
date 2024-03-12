export interface AddressesJson {
    [network: string]: NetworkAddressesJson
}

export interface NetworkAddressesJson {
    collaterals: { [name: string]: string }
    WNAT: string
    uniswapV2: string
    flashLender: string
}
