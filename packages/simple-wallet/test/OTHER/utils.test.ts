import { expect } from "chai";
import { WALLET } from "../../src";
import {
    bytesToHex,
    convertToTimestamp,
    getDateTimestampInSeconds,
    isValidHexString,
    prefix0x,
    stuckTransactionConstants,
    unPrefix0x,
} from "../../src/utils/utils";
import { toBN, toNumber } from "../../src/utils/bnutils";
import { ChainType } from "../../src/utils/constants";
import { initializeTestMikroORM } from "../test-orm/mikro-orm.config";
import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
import { getCurrentNetwork } from "../../src/chain-clients/utxo/UTXOUtils";

const BTCMccConnectionTestInitial = {
    url: process.env.BTC_URL ?? "",
    username: "",
    password: "",
    inTestnet: true,
};
const invalidChainType = "0x494e56414c494400000000000000000000000000000000000000000000000000" as ChainType;

describe("Util tests", () => {
    it("Should fail if unsupported network", async () => {
        const testOrm = await initializeTestMikroORM();
        const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
        const BTCMccConnectionTest = { ...BTCMccConnectionTestInitial, em: testOrm.em, walletKeys: unprotectedDBWalletKeys };
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
        const isValid3 = isValidHexString(valid);
        expect(isValid3).to.be.true;
        const isValid4 = isValidHexString(invalid);
        expect(isValid4).to.be.false;
    });

    it("Should convert to BN", async function () {
        const input1 = toBN(1);
        const input2 = 1;
        const input3 = "1";
        expect(input1.eq(toBN(input1)));
        expect(input1.eq(toBN(input2)));
        expect(input1.eq(toBN(input3)));
    });

    it("Should convert to number", async function () {
        const input1 = 1;
        const input2 = toBN(1);
        const input3 = "1";
        expect(input1).to.eq(toNumber(input1));
        expect(input1).to.eq(toNumber(input2));
        expect(input1).to.eq(toNumber(input3));
    });

    it("Should fail on invalid/unsupported chainType", () => {
        const fn2 = () => {
            return stuckTransactionConstants("invalid" as ChainType);
        };
        expect(fn2).to.throw(Error);
    });

    it("Should return invalid date", async () => {
        const fn = () => {
            return getDateTimestampInSeconds(NaN.toString());
        };
        expect(fn).to.throw(`Invalid date format`);
    });

    it("Should return timestamp", async function () {
        const input = "20240830203804";
        const expectedOutput = "1725050284";
        expect(convertToTimestamp(input)).to.eq(expectedOutput);
    });
});