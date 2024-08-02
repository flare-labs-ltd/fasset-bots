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
        FTestXRP: "0x901E620B91fBFa32f68738Ef9027Cdb76F21d208"
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
