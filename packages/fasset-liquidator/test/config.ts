// coston-beta
export const FTSO_SYMBOLS = {
    "coston": {
        USDC: "testUSDC",
        USDT: "testUSDT",
        WETH: "testETH",
        WNAT: "CFLR",
        TEST_XRP: "testXRP"
    }
}
export const ASSET_MANAGER_ADDRESSES = {
    "coston": {
        FTestXRP: "0x72995b59d89B0Dc7853a5Da1E16D6940522f2D7B"
    }
}
export const DEX_POOLS = {
    "coston": {
        FTestXRP: [
            [FTSO_SYMBOLS.coston.TEST_XRP, FTSO_SYMBOLS.coston.USDC],
            [FTSO_SYMBOLS.coston.TEST_XRP, FTSO_SYMBOLS.coston.USDT],
            [FTSO_SYMBOLS.coston.TEST_XRP, FTSO_SYMBOLS.coston.WETH],
            [FTSO_SYMBOLS.coston.TEST_XRP, FTSO_SYMBOLS.coston.WNAT]
        ]
    }
}
