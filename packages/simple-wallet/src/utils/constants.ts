import { RateLimitOptions } from "../interfaces/WalletTransactionInterface";
import { toBNExp } from "./bnutils";

export const LOCK_ADDRESS_FACTOR = 1.2;

export const MNEMONIC_STRENGTH = 256;

export const DEFAULT_FEE_INCREASE = 2;

///////////////////////////////////////////////////////////////////////////
// chain specs

export enum ChainType {
   // This values are hardcoded versions of `encodeAttestationName("BTC")`, etc.
   // This is to avoid adding dependency to state-connector-protocol just to calculate these values.
   BTC = "BTC",//"0x4254430000000000000000000000000000000000000000000000000000000000",
   DOGE = "DOGE",//"0x444f474500000000000000000000000000000000000000000000000000000000",
   XRP = "XRP",//"0x5852500000000000000000000000000000000000000000000000000000000000",
   testBTC = "testBTC",//"0x7465737442544300000000000000000000000000000000000000000000000000",
   testDOGE = "testDOGE",//"0x74657374444f4745000000000000000000000000000000000000000000000000",
   testXRP = "testXRP"//"0x7465737458525000000000000000000000000000000000000000000000000000",
   // ... make sure IDs are the same as in Flare attestation providers
}

// For storing ChainType in db in readable form
const chainTypeLookup: { [key: string]: string } = {};
Object.keys(ChainType).forEach(key => {
    const value = (ChainType as any)[key];
    chainTypeLookup[value] = key;
});
export function getChainTypeFromValue(value: string): string | undefined {
    return chainTypeLookup[value];
}

// From
// https://github.com/ranaroussi/pywallet/blob/eb784ea4dd62fe2a50e1352e7d24438fc66a4ac0/pywallet/network.py
// https://github.com/cryptocoinjs/coininfo

export const BTC_MAINNET = {
   messagePrefix: "\x18Bitcoin Signed Message:\n",
   bech32: "bc",
   bip32: { private: 0x0488ade4, public: 0x0488b21e },
   pubKeyHash: 0x00,
   scriptHash: 0x05,
   wif: 0x80,
   bip32Path: "m/44'/0'/0'",
};

export const BTC_TESTNET = {
   messagePrefix: "\x18Bitcoin Signed Message:\n",
   bech32: "tb",
   bip32: { private: 0x04358394, public: 0x043587cf },
   pubKeyHash: 0x6f,
   scriptHash: 0xc4,
   wif: 0xef,
   bip32Path: "m/44'/1'/0'",
};

export const DOGE_MAINNET = {
   messagePrefix: undefined,
   bech32: undefined,
   bip32: { private: 0x02fac398, public: 0x02facafd },
   pubKeyHash: 0x1e,
   scriptHash: 0x16,
   wif: 0x1e + 128,
   bip32Path: "m/44'/3'/0'",
};

export const DOGE_TESTNET = {
   messagePrefix: undefined,
   bech32: undefined,
   bip32: { private: 0x0432a243, public: 0x0432a9a8 },
   pubKeyHash: 0x71,
   scriptHash: 0xc4,
   wif: 0x71 + 128,
   bip32Path: "m/44'/1'/0'",
};

///////////////////////////////////////////////////////////////////////////
// network configs

export const DEFAULT_RATE_LIMIT_OPTIONS: RateLimitOptions = {
   maxRPS: 5,
   maxRequests: 10,
   timeoutMs: 60000,
   retries: 10,
};

export const DEFAULT_RATE_LIMIT_OPTIONS_XRP: RateLimitOptions = {
   ...DEFAULT_RATE_LIMIT_OPTIONS,
   timeoutMs: 20000,
};

// Approximate times between blocks, in milliseconds
export const BTC_LEDGER_CLOSE_TIME_MS = 600000; // 10min
export const DOGE_LEDGER_CLOSE_TIME_MS = 60000; // 60s
export const XRP_LEDGER_CLOSE_TIME_MS = 4000; // 4s

// Number of decimal places
export const BTC_DOGE_DEC_PLACES = 8;
export const XRP_DECIMAL_PLACES = 6;

// Minimum amount for an output for it not to be considered a dust output
// https://github.com/dogecoin/dogecoin/blob/a758fa798217ea7c12e08224596dc0ae9c03b2a8/doc/fee-recommendation.md
export const DOGE_DUST_AMOUNT = toBNExp(0.01, BTC_DOGE_DEC_PLACES); // 0.01 DOGE
// https://github.com/bitpay/bitcore/blob/fbc6b5b4a42d84a49a403c2fb5f47116074d089a/packages/bitcore-lib/lib/transaction/transaction.js#L66
export const BTC_DUST_AMOUNT = toBNExp(0.00000546, BTC_DOGE_DEC_PLACES);

// https://xrpl.org/docs/concepts/accounts/deleting-accounts/#requirements
export const DELETE_ACCOUNT_OFFSET = 256;

// https://bitcoinops.org/en/tools/calc-size/
export const UTXO_INPUT_SIZE = 134; //148?
export const UTXO_OUTPUT_SIZE = 34;
export const UTXO_OVERHEAD_SIZE = 10;

export const UTXO_INPUT_SIZE_SEGWIT = 68;
export const UTXO_OUTPUT_SIZE_SEGWIT = 31;
export const UTXO_OVERHEAD_SIZE_SEGWIT = 10.5;
