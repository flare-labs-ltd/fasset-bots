import { RippleWalletConfig, AlgoWalletConfig, BitcoinWalletConfig, DogecoinWalletConfig, LitecoinWalletConfig } from "./interfaces/WriteWalletInterface";
export { WriteWalletInterface as WalletClient } from "./interfaces/WriteWalletInterface";

export type WalletCreate = BitcoinWalletConfig | DogecoinWalletConfig | LitecoinWalletConfig | AlgoWalletConfig | RippleWalletConfig;
