import { BaseRpcConfig, RippleRpcConfig, AlgoRpcConfig } from "./interfaces/WriteWalletRpcInterface";
export { WriteWalletRpcInterface as WalletClient } from "./interfaces/WriteWalletRpcInterface";

export type WalletCreate = BaseRpcConfig | AlgoRpcConfig | RippleRpcConfig;
