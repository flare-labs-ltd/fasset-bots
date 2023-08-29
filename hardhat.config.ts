import { HardhatUserConfig } from "hardhat/config"
import '@typechain/hardhat'
import "@nomiclabs/hardhat-web3"
import "@nomiclabs/hardhat-ethers"

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    coston: {
      url: "https://coston-api.flare.network/ext/C/rpc",
      chainId:  16
    },
    costwo: {
      url: "https://coston2-api.flare.network/ext/C/rpc",
      chainId: 114
    },
    fuji: {
      url: "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113
    }
  }
}

export default config