import { expect } from "chai";
import { WALLET } from "../../src";
import { bytesToHex, getAvgBlockTime, getCurrentNetwork, isValidBytes32Hex, isValidHexString, prefix0x, requireEnv, stuckTransactionConstants, unPrefix0x, wallet_utxo_ensure_data, xrp_ensure_data } from "../../src/utils/utils";
import { toBN, toNumber } from "../../src/utils/bnutils";
import { ChainType } from "../../src/utils/constants";

const BTCMccConnectionTest = {
   url: process.env.BTC_URL ?? "",
   username: "",
   password: "",
   inTestnet: true,
};
const invalidChainType = "0x494e56414c494400000000000000000000000000000000000000000000000000" as ChainType;

describe("Util tests", () => {
   it("Should fail if status not 'OK'", async () => {
      const data = {
         statusText: "FAIL",
      };
      const fn = () => {
         return wallet_utxo_ensure_data(data);
      };
      expect(fn).to.throw(Error);
   });

   it("Should not fail if status is 'OK'", async () => {
      const data = {
         statusText: "OK",
      };
      const fn = () => {
         return wallet_utxo_ensure_data(data);
      };
      expect(fn).to.not.throw(Error);
   });

   it("Should fail if not desired error code or error message", async () => {
      const dataXrp = {
         result: {
            status: "error",
            error: "txnNotFound"
         }
      };
      const fn2 = () => {
         return xrp_ensure_data(dataXrp);
      };
      expect(fn2).to.throw(Error);
      dataXrp.result.error = "lgrNotFound"
      const fn3 = () => {
         return xrp_ensure_data(dataXrp);
      };
      expect(fn3).to.throw(Error);
      dataXrp.result.error = "someOther"
      const fn4 = () => {
         return xrp_ensure_data(dataXrp);
      };
      expect(fn4).to.throw(Error);
   });

   it("Should fail if env variable not defined", async () => {
      const envVariable = "I_AM_NOT_DEFINED";
      const fn = () => {
         return requireEnv(envVariable);
      };
      expect(fn).to.throw(`Environment value ${envVariable} not defined`);
   });

   it("Should fail if unsupported network", async () => {
      const wClient = await WALLET.BTC.initialize(BTCMccConnectionTest);
      wClient.chainType = invalidChainType;
      const fn = () => {
         return getCurrentNetwork(wClient.chainType);
      };
      expect(fn).to.throw(Error);
   });

   it("Should convert bytes as Buffer -> hex ", async function () {
      const expected0 = "000000";
      const bytes0 = Buffer.from([0, 0, 0]);
      const hex0 = bytesToHex(bytes0);
      expect(hex0).to.equal(expected0);

      const expected1 = "DEADBEEF";
      const bytes1 = Buffer.from([222, 173, 190, 239]);
      const hex1 = bytesToHex(bytes1);
      expect(hex1).to.equal(expected1);
   });

   it("Should convert bytes as Uint8Array -> hex", async function () {
      const expected0 = "000000";
      const bytes0 = new Uint8Array([0, 0, 0]);
      const hex0 = bytesToHex(bytes0);
      expect(hex0).to.equal(expected0);

      const expected1 = "DEADBEEF";
      const bytes1 = new Uint8Array([222, 173, 190, 239]);
      const hex1 = bytesToHex(bytes1);
      expect(hex1).to.equal(expected1);
   });

   it("Should unPrefix0x", async function () {
      const expected = "42284000700000620000260990000071310300057";
      const unPrefixed1 = unPrefix0x("0x" + expected);
      expect(unPrefixed1).to.equal(expected);
      const unPrefixed2 = unPrefix0x(expected);
      expect(unPrefixed2).to.equal(expected);
   });

   it("Should prefix0x", async function () {
      const expected = "0x42284000700000620000260990000071310300057";
      const unPrefixed1 = prefix0x(expected);
      expect(unPrefixed1).to.equal(expected);
      const unPrefixed2 = prefix0x(expected.slice(2));
      expect(unPrefixed2).to.equal(expected);
   });

   it("Should validate 32Hex and hex", async function () {
      const valid = "0x10000000000000000000000000000000000000000beefbeaddeafdeaddeedcab";
      const invalid = "0x10000000000000000000000000000000000000000beefbeaddeafdeaddeedcaZ";
      const isValid1 = isValidBytes32Hex(valid);
      expect(isValid1).to.be.true;
      const isValid2 = isValidBytes32Hex(invalid);
      expect(isValid2).to.be.false;
      const isValid3 = isValidHexString(valid);
      expect(isValid3).to.be.true;
      const isValid4 = isValidHexString(invalid);
      expect(isValid4).to.be.false;
   });

   it("Should convert to BN", async function () {
      const input1 = toBN(1);
      const input2 = 1;
      const input3 = "1"
      expect(input1.eq(toBN(input1)));
      expect(input1.eq(toBN(input2)));
      expect(input1.eq(toBN(input3)));
   });

   it("Should convert to number", async function () {
      const input1 = 1;
      const input2 = toBN(1);
      const input3 = "1"
      expect(input1).to.eq(toNumber(input1));
      expect(input1).to.eq(toNumber(input2));
      expect(input1).to.eq(toNumber(input3));
   });

   it("Should fail on invalid/unsupported chainType", () => {
      const fn1 = () => {
         return getAvgBlockTime("invalid" as ChainType);
      };
      expect(fn1).to.throw(Error);
      const fn2 = () => {
         return stuckTransactionConstants("invalid" as ChainType);
      };
      expect(fn2).to.throw(Error);
   });

});
