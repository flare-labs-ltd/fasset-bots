export interface AddressesJson {
    [network: string]: NetworkAddressesJson
}

export interface NetworkAddressesJson {
    collaterals: {
        USDC: string
        USDT: string
        WETH: string
    },
    WNAT: string
    uniswapV2: string
    flashLender: string
}
