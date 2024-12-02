import { expect } from "chai";
import { BTC_DEFAULT_FEE_PER_KB, BTC_DUST_AMOUNT, BTC_MIN_ALLOWED_FEE_PER_KB, ChainType, DOGE_DEFAULT_FEE_PER_KB, DOGE_DUST_AMOUNT, DOGE_MIN_ALLOWED_AMOUNT_TO_SEND, TEST_BTC_DEFAULT_FEE_PER_KB, UTXO_OUTPUT_SIZE, UTXO_OUTPUT_SIZE_SEGWIT } from "../../src/utils/constants";
import * as utxoUtils from "../../src/chain-clients/utxo/UTXOUtils";
import { toBN } from "web3-utils";

describe("UTXO utils tests", () => {

    it("Should get default block time", () => {
        expect(utxoUtils.getDefaultBlockTimeInSeconds(ChainType.DOGE)).gt(0);
        expect(utxoUtils.getDefaultBlockTimeInSeconds(ChainType.testDOGE)).gt(0);
        expect(utxoUtils.getDefaultBlockTimeInSeconds(ChainType.BTC)).gt(0);
        expect(utxoUtils.getDefaultBlockTimeInSeconds(ChainType.testBTC)).gt(0);
    });

    it("Should get dust amount", () => {
        expect(utxoUtils.getDustAmount(ChainType.DOGE).eq(DOGE_DUST_AMOUNT)).to.be.true;
        expect(utxoUtils.getDustAmount(ChainType.testDOGE).eq(DOGE_DUST_AMOUNT)).to.be.true;
        expect(utxoUtils.getDustAmount(ChainType.BTC).eq(BTC_DUST_AMOUNT)).to.be.true;
        expect(utxoUtils.getDustAmount(ChainType.testBTC).eq(BTC_DUST_AMOUNT)).to.be.true;
    });

    it("Should get output size", () => {
        expect(utxoUtils.getOutputSize(ChainType.DOGE)).to.eq(UTXO_OUTPUT_SIZE);
        expect(utxoUtils.getOutputSize(ChainType.testDOGE)).to.eq(UTXO_OUTPUT_SIZE);
        expect(utxoUtils.getOutputSize(ChainType.BTC)).to.eq(UTXO_OUTPUT_SIZE_SEGWIT);
        expect(utxoUtils.getOutputSize(ChainType.testBTC)).to.eq(UTXO_OUTPUT_SIZE_SEGWIT);
    });

    it("Should estimate number of outputs", () => {
        expect(utxoUtils.getEstimatedNumberOfOutputs(toBN(1), "note")).to.eq(3);
        expect(utxoUtils.getEstimatedNumberOfOutputs(null)).to.eq(1);
        expect(utxoUtils.getEstimatedNumberOfOutputs(null, "note")).to.eq(2);
        expect(utxoUtils.getEstimatedNumberOfOutputs(toBN(1))).to.eq(2);
    });

    it("Should get confirmed after", () => {
        expect(utxoUtils.getConfirmedAfter(ChainType.DOGE)).to.eq(60);
        expect(utxoUtils.getConfirmedAfter(ChainType.testDOGE)).to.eq(60);
        expect(utxoUtils.getConfirmedAfter(ChainType.BTC)).to.eq(6);
        expect(utxoUtils.getConfirmedAfter(ChainType.testBTC)).to.eq(6);
    });

    it("Should get confirmed after", () => {
        const fn = () => {
            return utxoUtils.getConfirmedAfter(ChainType.testXRP);
        };
        expect(fn).to.throw(`Unsupported chain type ${ChainType.testXRP}`);
    });

    it("Should get default fee per kb", () => {
        expect(utxoUtils.getDefaultFeePerKB(ChainType.DOGE).eq(DOGE_DEFAULT_FEE_PER_KB)).to.be.true;
        expect(utxoUtils.getDefaultFeePerKB(ChainType.testDOGE).eq(DOGE_DEFAULT_FEE_PER_KB)).to.be.true;
        expect(utxoUtils.getDefaultFeePerKB(ChainType.BTC).eq(BTC_DEFAULT_FEE_PER_KB)).to.be.true;
        expect(utxoUtils.getDefaultFeePerKB(ChainType.testBTC).eq(TEST_BTC_DEFAULT_FEE_PER_KB)).to.be.true;
        const fn = () => {
            return utxoUtils.getDefaultFeePerKB(ChainType.testXRP);
        };
        expect(fn).to.throw(`Unsupported chain type ${ChainType.testXRP}`);
    });

    it("Should enforce fee", () => {
        expect(utxoUtils.enforceMinimalAndMaximalFee(ChainType.BTC, BTC_MIN_ALLOWED_FEE_PER_KB.subn(1)).eq(BTC_MIN_ALLOWED_FEE_PER_KB)).to.be.true;
        expect(utxoUtils.enforceMinimalAndMaximalFee(ChainType.DOGE, DOGE_DEFAULT_FEE_PER_KB).eq(DOGE_DEFAULT_FEE_PER_KB)).to.be.true;
    });
});