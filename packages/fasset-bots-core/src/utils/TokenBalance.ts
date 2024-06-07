import BN from "bn.js";
import { IERC20MetadataInstance } from "../../typechain-truffle";
import { IBlockChainWallet } from "../underlying-chain/interfaces/IBlockChainWallet";
import { Currency } from "./Currency";
import { FormatSettings } from "./formatting";
import { toBN } from "./helpers";
import { web3 } from "./web3";

export abstract class TokenBalance extends Currency {
    constructor(symbol: string, decimals: number) {
        super(symbol, decimals);
    }

    abstract balance(address: string): Promise<BN>;

    async formatBalance(address: string, format?: FormatSettings) {
        const balance = await this.balance(address);
        return this.format(balance, format);
    }
}

export class EVMNativeTokenBalance extends TokenBalance {
    async balance(address: string) {
        return toBN(await web3.eth.getBalance(address));
    }
}

export class WalletTokenBalance extends TokenBalance {
    constructor(
        public wallet: IBlockChainWallet,
        symbol: string,
        decimals: number,
    ) {
        super(symbol, decimals);
    }

    balance(address: string) {
        return this.wallet.getBalance(address);
    }
}

export class ERC20TokenBalance extends TokenBalance {
    constructor(
        public token: IERC20MetadataInstance,
        symbol: string,
        decimals: number,
    ) {
        super(symbol, decimals);
    }

    balance(address: string) {
        return this.token.balanceOf(address);
    }

    totalSupply() {
        return this.token.totalSupply();
    }
}
