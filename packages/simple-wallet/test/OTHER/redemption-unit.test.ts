// import {
//     BitcoinWalletConfig,
//     BTC,
//     logger,
// } from "../../src";
// import { addConsoleTransportForTests } from "../test-util/common_utils";
// import { initializeTestMikroORM, ORM } from "../test-orm/mikro-orm.config";
// import { UnprotectedDBWalletKeys } from "../test-orm/UnprotectedDBWalletKey";
// import chaiAsPromised from "chai-as-promised";
// import BN, { max } from "bn.js";
// import { toBN } from "web3-utils";
// import { expect, use } from "chai";
// import { TransactionFeeService } from "../../src/chain-clients/utxo/TransactionFeeService";
// import { createUTXO } from "../test-util/entity_utils";
// import sinon from "sinon";
// import { toBNExp } from "../../src/utils/bnutils";
// import { BTC_DOGE_DEC_PLACES } from "../../src/utils/constants";
// import { TransactionUTXOService } from "../../src/chain-clients/utxo/TransactionUTXOService";
// import { getMinimumUTXOValue } from "../../src/chain-clients/utxo/UTXOUtils";
// import { MempoolUTXO } from "../../src/interfaces/IBlockchainAPI";
// import { Transaction } from "bitcore-lib";

// use(chaiAsPromised);

// const walletSecret = "wallet_secret";
// const BTCMccConnectionTestInitial = {
//     urls: [process.env.BTC_URL ?? ""],
//     apiTokenKey: process.env.FLARE_API_PORTAL_KEY ?? "",
//     inTestnet: true,
//     walletSecret: walletSecret,
//     minimumUTXOValue: toBN(100000),
// };
// let BTCMccConnectionTest: BitcoinWalletConfig;

// const fundedAddress = "tb1qyghw9dla9vl0kutujnajvl6eyj0q2nmnlnx3j0";
// const targetAddress = "tb1q8j7jvsdqxm5e27d48p4382xrq0emrncwfr35k4";

// let wClient: BTC;
// let testOrm: ORM;

// describe("UTXO selection algorithm test", () => { //TODO - fix after merge

//     const lotSize = toBNExp(200, BTC_DOGE_DEC_PLACES);

//     const mintFeePercentage = 10; // Units are in 0.1% - 10% mint fee
//     const redemptionFeePercentage = 5;

//     before(async () => {
//         // sinon.stub(utxoUtils, "getMinimumUTXOValue").returns(toBNExp(1, BTC_DOGE_DEC_PLACES)); // 1 DOGE

//         addConsoleTransportForTests(logger);
//         testOrm = await initializeTestMikroORM();
//         const unprotectedDBWalletKeys = new UnprotectedDBWalletKeys(testOrm.em);
//         BTCMccConnectionTest = {
//             ...BTCMccConnectionTestInitial,
//             em: testOrm.em,
//             walletKeys: unprotectedDBWalletKeys,
//             enoughConfirmations: 1,
//         };
//         wClient = BTC.initialize(BTCMccConnectionTest);
//     });

//     beforeEach(() => {
//         sinon.restore();
//         sinon.stub(TransactionUTXOService.prototype, "getNumberOfMempoolAncestors").resolves(0);

//         // sinon.stub(TransactionFeeService.prototype, "getFeePerKB").resolves(new BN(1_000_000_000 * 1000));
//         // sinon.stub(TransactionFeeService.prototype, "getFeePerKB").resolves(new BN(100_000_000 * 1000));
//         sinon.stub(TransactionFeeService.prototype, "getFeePerKB").resolves(new BN(1_000_000 * 1000));
//         // sinon.stub(TransactionFeeService.prototype, "getFeePerKB").resolves(new BN(100_000 * 1000));
//     });

//     after(async () => {
//         await testOrm.close();
//     });

//     it("Redeeming one lot", async () => {
//         const [amount, redemptionFee] = calculateAmountAndRedemptionFee(1);
//         const utxos = [
//             createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//         ];

//         sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves(utxos);
//         const [tr, ] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, amount, undefined, undefined, undefined, undefined, undefined, undefined, redemptionFee);
//         expect(tr.outputs.filter(output => !toBN(output.satoshis).gte(getMinimumUTXOValue(wClient.chainType))).length).to.be.eq(0);

//         formatTr(tr);
//     });

//     it("Redeeming one lot 2", async () => {
//         const [amount, redemptionFee] = calculateAmountAndRedemptionFee(1);
//         const utxos = [
//             createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, calculateUTXOSize(3), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, calculateUTXOSize(3), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//         ];

//         sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves(utxos);
//         const [tr,] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, amount, undefined, undefined, undefined, undefined, undefined, undefined, redemptionFee);
//         expect(tr.outputs.filter(output => !toBN(output.satoshis).gte(getMinimumUTXOValue(wClient.chainType))).length).to.be.eq(0);

//         formatTr(tr);
//     });

//     it("Redeeming multiple lots", async () => {
//         const [amount, redemptionFee] = calculateAmountAndRedemptionFee(4);
//         const utxos = [
//             createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//         ];

//         sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves(utxos);
//         const [tr] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, amount, undefined, undefined, undefined, undefined, undefined, undefined, redemptionFee);
//         expect(tr.outputs.filter(output => !toBN(output.satoshis).gte(getMinimumUTXOValue(wClient.chainType))).length).to.be.eq(0);
//         expect(tr.inputs.length).to.be.lte(3);

//         formatTr(tr);
//     });

//     it("Redeeming multiple lots 2", async () => {
//         const [amount, redemptionFee] = calculateAmountAndRedemptionFee(7);
//         const utxos = [
//             createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//         ];

//         sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves(utxos);
//         const [tr] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, amount, undefined, undefined, undefined, undefined, undefined, undefined, redemptionFee);
//         expect(tr.outputs.filter(output => !toBN(output.satoshis).gte(getMinimumUTXOValue(wClient.chainType))).length).to.be.eq(0);
//         expect(tr.inputs.length).to.be.eq(4);

//         formatTr(tr);
//     });

//     it("Redeeming multiple lots 3", async () => {
//         const [amount, redemptionFee] = calculateAmountAndRedemptionFee(3);
//         const utxos = [
//             createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, calculateUTXOSize(5), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, calculateUTXOSize(3), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, calculateUTXOSize(2), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//             createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, calculateUTXOSize(1), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//         ];

//         sinon.stub(TransactionUTXOService.prototype, "filteredAndSortedMempoolUTXOs").resolves(utxos);
//         const [tr, ] = await wClient.transactionService.preparePaymentTransaction(0, fundedAddress, targetAddress, amount, undefined, undefined, undefined, undefined, undefined, undefined, redemptionFee);
//         expect(tr.outputs.filter(output => !toBN(output.satoshis).gte(getMinimumUTXOValue(wClient.chainType))).length).to.be.eq(0);
//         expect(tr.inputs.length).to.be.lte(2);

//         formatTr(tr);
//     });

//     function calculateUTXOSize(nLots: number) {
//         return lotSize.muln(nLots).add(lotSize.muln(nLots).muln(mintFeePercentage).divn(1000));
//     }

//     function calculateAmountAndRedemptionFee(nLots: number) {
//         const redemptionFee = lotSize.muln(nLots).muln(redemptionFeePercentage).divn(1000);
//         const amount = lotSize.muln(nLots).muln(1).sub(redemptionFee);
//         return [amount, redemptionFee];
//     }
// });


// function formatTr(tr: Transaction) {
//     logger.info(`Inputs: ${tr.inputs.map(input => Math.round(100 * input.output!.satoshis! / toBNExp(1, 8).toNumber()) / 100)}`);
//     logger.info(`Outputs: ${tr.outputs.map(output => Math.round(100 * output.satoshis! / toBNExp(1, 8).toNumber()) / 100)}`);
// }

// const utxoList = [
//     createUTXO("ef99f95e95b18adfc44aae79722946e583677eb631a89a1b62fe0e275801a10c", 0, toBN(10020), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("2a6a5d5607492467e357140426f48e75e5ab3fa5fb625b6f201cce284f0dc55e", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("b895eab0cd280d1bb07897576e2edbdd7791d8b85bb64e28a9b86952faf8fdc2", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("0b24228b83a64803ccf00f9878d56a0306c4b76f17c4b5bdc1cd35358e04feb5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("b8aac7ed190bf30610cd904e533eadabfee824054eb14a1e3a56cf1965b495d5", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("52cf7492f717363cef1befcb7b4972adb053b65f2ec1763ac95c1e6312868dc6", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("de3e8d9439325c51876e039cda60c35dc491e3c7c9045ae43759c011108993c6", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("1a31d01de95dc4346084c387731701d7d09dec86bcceefcf6a048e18ab2a4c7b", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("eb4806e9b879ef4431edf322f1b5cb3b454e79003bbeaa1d2b5000d20719fdbc", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("f165d22a1a63dd45921c597cf77a51224db146c60b873f81866ed8d352eca54c", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("281219ee58c3cc5dfb14ba1e62ac306dab6ad75a1c63909d257a5bcc7427af21", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("e71687c5b4f26a28800334f4d33ef17b6a2e3cb8549af120649e4898659e1e62", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
//     createUTXO("6c92762544368c03c3c609cd1edcb9dd4b50759a9e864a67555806ba42e1851c", 0, toBN(1000), "00143cbd2641a036e99579b5386b13a8c303f3b1cf0e"),
// ];
