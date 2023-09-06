import { HardhatUserConfig } from "hardhat/config"
import '@typechain/hardhat'
import '@typechain/truffle-v5'
import '@nomiclabs/hardhat-web3'
import "@nomiclabs/hardhat-ethers"
import "@nomiclabs/hardhat-truffle5"

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      evmVersion: "london",
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
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
    }
  },
  typechain: {
    outDir: "typechain-truffle",
    target: "truffle-v5",
  },
  paths: {
    sources: "./contracts/",
    cache: "./cache",
    artifacts: "./artifacts"
},
}

export default config