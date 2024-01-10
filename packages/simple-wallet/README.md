# Simple wallet

This is a Typescript library that allows querying basic wallet functions from any blockchain in a unified manner. It somewhat dependent on [MCC](https://github.com/flare-foundation/multi-chain-client) and some useful blockchain essentials can be found on their [docs](https://github.com/flare-foundation/multi-chain-client/blob/main/docs/README.md).

## Supported blockchains

- [BTC](https://developer.bitcoin.org/index.html)
- [LTC](https://litecoin.org/)
- [DOGE](https://dogecoin.com/)
- [XRP](https://xrpl.org/docs.html)
- [ALGO](https://developer.algorand.org/docs/)

## Installation

- Clone the project, change directory to `simple-wallet`.

```
git clone git@gitlab.com:flarenetwork/simple-wallet.git
cd simple-wallet
```

- Install `node_modules`

```
yarn
```

- Create following `.env` file in root directory (see `.env.template`)

## Examples

Examples for **creating a wallet**, **preparing transaction**, **signing transaction**, **submitting transaction** and **getting balance** can be found in the following test files. Examples are working with the `.env` file provided above.


- [ALGO examples](./test/ALGO/wallet.test.ts),
- [BTC examples](./test/BTC/wallet.test.ts),
- [DOGE examples](./test/DOGE/wallet.test.ts),
- [LTC examples](./test/LTC/wallet.test.ts),
- [XRP examples](./test/XRP/wallet.test.ts).

## Implementation

Implemented functions:

```javascript
createWallet(): ICreateWalletResponse;
createWalletFromMnemonic(mnemonic: string): ICreateWalletResponse;

getAccountBalance(account: string): Promise<number>;
getCurrentTransactionFee(): Promise<number>;

preparePaymentTransaction(
   source: string,
   destination: string,
   amount: number,
   fee?: number,
   note?: string,
   maxFee?: number,
   sequence?: number
): Promise<any>;
signTransaction(transaction: any, privateKey: string): Promise<string>;
submitTransaction(signedTx: string): Promise<any>;
submitTransactionAndWait(signedTx: string): Promise<any>;
```

## Tests

Test files are stored in directory `test` and are split into subdirectories. Test directly linked to blockchains can be found in:

- [`test/ALGO`](./test/ALGO),
- [`test/BTC`](./test/BTC),
- [`test/DOGE`](./test/DOGE),
- [`test/LTC`](./test/LTC),
- [`test/XRP`](./test/XRP).

Other tests can be found in [`test/OTHER`](./test/OTHER).

### Running tests

Single can be run with following command:

```
yarn test test/[subdirectory]/[test-file].test.ts
```

Test coverage can be run with following command:

```
yarn test test:coverage
```
Beware currently timeout on coverage tests in set to ```500000ms```.

## Minimum balance

For account to be activated some minimum balance should be satisfied.

#### ALGO:
- [Minimum balance](https://developer.algorand.org/docs/get-details/accounts/#minimum-balance) is 0.1 ALGO


#### XRP:
- [Minimum balance](https://xrpl.org/accounts.html) is 10 XRP

## Testnet faucets

#### ALGO:
- [https://testnet.algoexplorer.io/dispenser](https://testnet.algoexplorer.io/dispenser) - 10 ALGO
- [https://dispenser.testnet.aws.algodev.network](https://dispenser.testnet.aws.algodev.network/) - 5 ALGO
- [https://bank.testnet.algorand.network](https://bank.testnet.algorand.network/) - 10 ALGO

#### BTC:
- [https://testnet-faucet.com/btc-testnet](https://testnet-faucet.com/btc-testnet/) - cca 0.00075 BTC per hour
- [https://bitcoinfaucet.uo1.net](https://bitcoinfaucet.uo1.net/) - 0.0007 BTC per hour

#### DOGE:
- [https://testnet-faucet.com/doge-testnet](https://testnet-faucet.com/doge-testnet/) - cca 100 DOGE per hour
- [https://shibe.technology](https://shibe.technology/) - 100 DOGE par day
- [https://doge-faucet-testnet.ggcorp.fr](https://doge-faucet-testnet.ggcorp.fr/) - 5x 100 DOGE per hour

#### LTC:
- [https://testnet-faucet.com/ltc-testnet](https://testnet-faucet.com/ltc-testnet/) - cca 0.25 LTC per hour
- [http://litecointf.salmen.website](http://litecointf.salmen.website/) - 1 LTC per hour

#### XRP:
- [https://yusufsahinhamza.github.io/xrp-testnet-faucet](https://yusufsahinhamza.github.io/xrp-testnet-faucet/) - 980 XRP
- [https://xrpl.org/xrp-testnet-faucet.html](https://xrpl.org/xrp-testnet-faucet.html) - 1000 XRP (they generate the address)

## Blockchain explorers
Following are some of mainnet and testnet explorers:

#### ALGO:
- Mainnet explorer: [https://algoexplorer.io](https://algoexplorer.io)
- Testnet explorer: [https://testnet.algoexplorer.io](https://testnet.algoexplorer.io)

#### BTC:
- Mainnet explorer: [https://sochain.com/btc](https://sochain.com/btc)
- Testnet explorer: [https://sochain.com/testnet/btc](https://sochain.com/testnet/btc)

#### DOGE:
- Mainnet explorer: [https://sochain.com/doge](https://sochain.com/doge)
- Testnet explorer: [https://sochain.com/testnet/doge](https://sochain.com/testnet/doge)

#### LTC:
- Mainnet explorer: [https://sochain.com/ltc](https://sochain.com/ltc)
- Testnet explorer: [https://sochain.com/testnet/ltc](https://sochain.com/testnet/ltc)

#### XRP:
- Mainnet explorer: [https://livenet.xrpl.org](https://livenet.xrpl.org/)
- Testnet explorer: [https://testnet.xrpl.org](https://testnet.xrpl.org/)

## Basic use

Following is a minimal example to create a wallet on BTC blockchain with a custom connection.

```javascript
// Configuration object
const connectConfig = {
   url: "https://myAwesomeBtcTestnetNode.com/",
   username: "user",
   password: "pass",
   inTestnet: true
};

// WALLET object used to connect to Bitcoin node
const wClient = new WALLET.BTC(connectConfig);

// Create a wallet
const newAccount = wClient();
// Log wallet details
console.log(newAccount); // => { address: <address>, mnemonic: <mnemonic>, privateKey: <privateKey>, publicKey: <publicKey> }
```

