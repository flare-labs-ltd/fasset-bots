import chalk from 'chalk';
import { readFileSync } from 'fs';
import { BotConfig, BotConfigFile, createBotConfig } from "../config/BotConfig";
import { createAssetContext } from '../config/create-asset-context';
import { AvailableAgentInfo } from '../fasset/AssetManagerTypes';
import { IAssetContext } from "../fasset/IAssetContext";
import { Minter } from '../mock/Minter';
import { proveAndUpdateUnderlyingBlock } from '../utils/fasset-helpers';
import { BNish, CommandLineError, requireEnv } from '../utils/helpers';
import { initWeb3 } from '../utils/web3';

export class UserBot {
    context!: IAssetContext;
    botConfig!: BotConfig;
    nativeAddress!: string;
    underlyingAddress!: string;

    async initialize(configFile: string, fAssetSymbol: string) {
        console.error(chalk.cyan('Initializing environment...'));
        const runConfig = JSON.parse(readFileSync(configFile).toString()) as BotConfigFile;
        // init web3 and accounts
        this.nativeAddress = requireEnv('USER_ADDRESS');
        const nativePrivateKey = requireEnv('USER_PRIVATE_KEY');
        const accounts = await initWeb3(runConfig.rpcUrl, [nativePrivateKey], null);
        if (this.nativeAddress !== accounts[0]) throw new Error("Invalid address/ private key pair");
        // create config
        this.botConfig = await createBotConfig(runConfig, this.nativeAddress);
        const chainConfig = this.botConfig.chains.find(cc => cc.fAssetSymbol === fAssetSymbol);
        if (chainConfig == null) throw new CommandLineError("Invalid FAsset symbol");
        this.context = await createAssetContext(this.botConfig, chainConfig);
        // create underlying wallet key
        this.underlyingAddress = requireEnv('USER_UNDERLYING_ADDRESS');
        const underlyingPrivateKey = requireEnv('USER_UNDERLYING_PRIVATE_KEY');
        await this.context.wallet.addExistingAccount(this.underlyingAddress, underlyingPrivateKey);
        console.error(chalk.cyan('Environment successfully initialized.'));
    }

    async updateUnderlyingTime() {
        console.log("Updating underlying block time....");
        await proveAndUpdateUnderlyingBlock(this.context, this.nativeAddress);
    }

    async getAvailableAgents() {
        const result: AvailableAgentInfo[] = [];
        const chunkSize = 10;
        let start = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const { 0: list } = await this.context.assetManager.getAvailableAgentsDetailedList(start, chunkSize);
            result.splice(result.length, 0, ...list);
            if (list.length < chunkSize) break;
            start += list.length;
        }
        return result;
    }

    async mint(agentVault: string, lots: BNish) {
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Reserving collateral...");
        const crt = await minter.reserveCollateral(agentVault, lots);
        console.log(`Paying on the underlying chain for reservation ${crt.collateralReservationId} to address ${crt.paymentAddress}...`);
        const txHash = await minter.performMintingPayment(crt);
        await this.proveAndExecuteMinting(crt.collateralReservationId, crt.paymentAddress, txHash);
    }

    async proveAndExecuteMinting(collateralReservationId: BNish, paymentAddress: string, transactionHash: string) {
        const minter = new Minter(this.context, this.nativeAddress, this.underlyingAddress, this.context.wallet);
        console.log("Waiting for transaction finalization...")
        await minter.waitForTransactionFinalization(transactionHash);
        console.log(`Waiting for proof of underlying payment transaction ${transactionHash}...`);
        const proof = await minter.proveMintingPayment(paymentAddress, transactionHash);
        console.log(`Executing payment...`);
        await minter.executeProvedMinting(collateralReservationId, proof);
        console.log("Done");
    }
}
