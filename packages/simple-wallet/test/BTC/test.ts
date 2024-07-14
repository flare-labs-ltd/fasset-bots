import { WALLET } from "../../src";
import { ICreateWalletResponse } from "../../src/interfaces/WriteWalletInterface";
import chaiAsPromised from "chai-as-promised";
import { expect, use } from "chai";
use(chaiAsPromised);
import WAValidator from "wallet-address-validator";
import { toBN } from "../../src/utils/bnutils";
import { ChainType } from "../../src/utils/constants";

// bitcoin test network with fundedAddress "mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE" at
// https://live.blockcypher.com/btc-testnet/address/mvvwChA3SRa5X8CuyvdT4sAcYNvN5FxzGE/

const BTCMccConnectionTest = {
   url: process.env.BTC_URL ?? "",
   username: "",
   password: "",
   apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
   inTestnet: true,
   walletSecret: "wallet_secret"
};

const fundedMnemonic = "depart mixed miss smart enjoy ladder deputy sport chair risk dismiss few";
const fundedAddress = "mzM88w7CdxrFyzE8RKZmDmgYQgT5YPdA6S";
const targetMnemonic = "involve essay clean frequent stumble cheese elite custom athlete rack obey walk";
const targetAddress = "mwLGdsLWvvGFapcFsx8mwxBUHfsmTecXe2";

const amountToSendInSatoshi = toBN(120000);
const feeInSatoshi = toBN(120000);
const maxFeeInSatoshi = toBN(110000);

let wClient: WALLET.BTC;
let fundedWallet: ICreateWalletResponse;

describe("Bitcoin wallet tests", () => {
   before(async () => {
      wClient = await WALLET.BTC.initialize(BTCMccConnectionTest);
   });

   it.only("Should lock and execute multiple transactions from the same address", async () => {
      const note = "eeee0000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      fundedWallet = wClient.createWalletFromMnemonic(fundedMnemonic);
      const balanceBefore = await wClient.getAccountBalance(targetAddress);
      const balanceBefore1 = await wClient.getAccountBalance(fundedWallet.address);
      console.log("UTXO0")
      const utxos0 = await wClient.fetchUTXOs(fundedWallet.address, amountToSendInSatoshi, 3);
      console.log(utxos0)
      const tx = await wClient.prepareAndExecuteTransaction(fundedWallet.address, fundedWallet.privateKey, targetAddress, amountToSendInSatoshi, undefined, note);
      console.log(tx);
      console.log("UTXO1")
      const utxos1 = await wClient.fetchUTXOs(fundedWallet.address, null, 0);
      console.log(utxos1)
      const balanceAfter = await wClient.getAccountBalance(targetAddress);
      const balanceAfter1 = await wClient.getAccountBalance(fundedWallet.address);
      console.log(balanceBefore.toString(), balanceAfter.toString())
      console.log(balanceBefore1.toString(), balanceAfter1.toString())

   });
});
