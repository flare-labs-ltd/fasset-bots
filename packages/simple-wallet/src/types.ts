import { RippleWalletConfig, BitcoinWalletConfig, DogecoinWalletConfig } from "./interfaces/WalletTransactionInterface";
export { WriteWalletInterface as WalletClient } from "./interfaces/WalletTransactionInterface";
export { WalletAccountGenerationInterface as WalletAccount } from "./interfaces/WalletTransactionInterface";

export type WalletCreate = BitcoinWalletConfig | DogecoinWalletConfig | RippleWalletConfig;
