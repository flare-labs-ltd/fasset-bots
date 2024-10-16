import { BtcWalletImplementation } from "./chain-clients/implementations/BtcWalletImplementation";
import { DogeWalletImplementation } from "./chain-clients/implementations/DogeWalletImplementation";
import { XrpWalletImplementation } from "./chain-clients/implementations/XrpWalletImplementation";
import { BtcAccountGeneration } from "./chain-clients/account-generation/BtcAccountGeneration";
import { DogeAccountGeneration } from "./chain-clients/account-generation/DogeAccountGeneration";
import { XrpAccountGeneration } from "./chain-clients/account-generation/XrpAccountGeneration";
import type { BitcoinWalletConfig, DogecoinWalletConfig, RippleWalletConfig } from "./interfaces/IWalletTransaction";

export * from "./entity/transaction";
export * from "./entity/wallet";
export * from "./entity/utxo";
export * from "./entity/monitoringState";
export type * from "./types";
export type { StuckTransaction } from "./interfaces/IWalletTransaction";
export { BtcAccountGeneration } from "./chain-clients/account-generation/BtcAccountGeneration";
export { DogeAccountGeneration } from "./chain-clients/account-generation/DogeAccountGeneration";
export { XrpAccountGeneration } from "./chain-clients/account-generation/XrpAccountGeneration";
export * from "./interfaces/IWalletTransaction";
export { logger } from "./utils/logger";
export * from "./utils/axios-utils";
export class XrpAccount extends XrpAccountGeneration {
    constructor(inTestnet: boolean) {
        super(inTestnet);
    }
}
export class BtcAccount extends BtcAccountGeneration {
    constructor(inTestnet: boolean) {
        super(inTestnet);
    }
}

export class DogeAccount extends DogeAccountGeneration {
    constructor(inTestnet: boolean) {
        super(inTestnet);
    }
}
export class XRP extends XrpWalletImplementation {
    constructor(options: RippleWalletConfig) {
        super(options);
    }
    static initialize(createConfig: RippleWalletConfig) {
        const wallet = new XrpWalletImplementation(createConfig);
        return wallet;
    }
}

export class BTC extends BtcWalletImplementation {
    constructor(options: BitcoinWalletConfig) {
        super(options);
    }
    static initialize(createConfig: BitcoinWalletConfig) {
        const wallet = new BtcWalletImplementation(createConfig);
        return wallet;
    }
}

export class DOGE extends DogeWalletImplementation {
    constructor(options: DogecoinWalletConfig) {
        super(options);
    }
    static initialize(createConfig: DogecoinWalletConfig) {
        const wallet = new DogeWalletImplementation(createConfig);
        return wallet;
    }
}
