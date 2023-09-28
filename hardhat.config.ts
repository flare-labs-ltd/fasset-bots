import { HardhatUserConfig } from "hardhat/config"
import '@typechain/hardhat'
import '@nomiclabs/hardhat-web3'
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-truffle5"
import "@nomiclabs/hardhat-waffle"
import "hardhat-gas-reporter"

const config: HardhatUserConfig = {
  // do not change, otherwise blazeswap will not work
  solidity: {
    version: '0.8.20',
    settings: {
      metadata: {
        bytecodeHash: 'none',
      },
      evmVersion: 'london',
      optimizer: {
        enabled: true,
        runs: 10000,
      },
    },
  },
  networks: {
    coston: {
      url: "https://coston-api.flare.network/ext/C/rpc",
      chainId: 16,
    },
    costwo: {
      url: "https://coston2-api.flare.network/ext/C/rpc",
      chainId: 114,
    },
    songbird: {
      url: "https://songbird-api.flare.network/ext/C/rpc",
      chainId: 19,
    },
    flare: {
      url: "https://flare-api.flare.network/ext/C/rpc",
      chainId: 14,
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  paths: {
    sources: "./contracts",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  gasReporter: {
    enabled: false
  }
}

export default config