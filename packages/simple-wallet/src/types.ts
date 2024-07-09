import { RippleWalletConfig, BitcoinWalletConfig, DogecoinWalletConfig } from "./interfaces/WriteWalletInterface";
export { WriteWalletInterface as WalletClient } from "./interfaces/WriteWalletInterface";

export type WalletCreate = BitcoinWalletConfig | DogecoinWalletConfig | RippleWalletConfig;
