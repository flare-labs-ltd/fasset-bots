import Web3 from "web3";
import { AgentEntity } from "./actors/entities";
import { PersistentAgent } from "./actors/PersistentAgent";
import { BotConfig, BotConfigChain } from './BotConfig';
import { IAssetContext } from './fasset/IAssetContext';
import { PersistenceContext } from './PersistenceContext';
import { AttestationHelper } from './underlying-chain/AttestationHelper';
import { UnderlyingChainEvents } from './underlying-chain/UnderlyingChainEvents';
import { artifacts } from './utils/artifacts';
import { web3 } from './utils/helpers';

const AssetManager = artifacts.require('AssetManager');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const IFtso = artifacts.require('IFtso');
const IFtsoRegistry = artifacts.require('IFtsoRegistry');
const IFtsoManager = artifacts.require('IFtsoManager');
const FAsset = artifacts.require('FAsset');

class PersistentAgentRunner {
    constructor(
        public context: IAssetContext,
        public pc: PersistenceContext,
    ) { }

    async run() {
        while (true) {
            this.pc.em = this.pc.orm.em.fork();
            await this.runStep();
        }
    }

    async runStep() {
        const agentEntities = await this.pc.em.find(AgentEntity, { active: true });
        for (const agentEntity of agentEntities) {
            try {
                const agent = await PersistentAgent.load(this.pc, this.context, agentEntity);
                await agent.handleEvents();
                await agent.handleOpenRedemptions();
            } catch (error) {
                console.error(`Error with agent ${agentEntity.vaultAddress}`, error);
            }
        }
    }

}

async function createAssetContext(botConfig: BotConfig, chainConfig: BotConfigChain): Promise<IAssetContext> {
    const assetManager = await AssetManager.at(chainConfig.assetManager);
    const addressUpdater = await AddressUpdater.at(botConfig.addressUpdater);
    const ftsoRegistry = await IFtsoRegistry.at(await addressUpdater.getContractAddress('FtsoRegistry'));
    const settings = await assetManager.getSettings();
    return {
        chainInfo: chainConfig.chainInfo,
        chain: chainConfig.chain,
        chainEvents: new UnderlyingChainEvents(chainConfig.chain, chainConfig.chainEvents, null),
        wallet: chainConfig.wallet,
        attestationProvider: new AttestationHelper(botConfig.stateConnector, chainConfig.chain, chainConfig.chainInfo.chainId),
        assetManager: assetManager,
        assetManagerController: await AssetManagerController.at(await addressUpdater.getContractAddress('AssetManagerController')),
        ftsoRegistry: ftsoRegistry,
        ftsoManager: await IFtsoManager.at(await addressUpdater.getContractAddress('FtsoManager')),
        wnat: await WNat.at(await addressUpdater.getContractAddress('WNat')),
        fAsset: await FAsset.at(await assetManager.fAsset()),
        natFtso: await IFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.natFtsoSymbol)),
        assetFtso: await IFtso.at(await ftsoRegistry.getFtsoBySymbol(settings.assetFtsoSymbol)),
    };
}

const main = async () => {
    const botConfig = await import(process.argv[2]).then(m => m.default) as BotConfig;
    web3.setProvider(new Web3.providers.HttpProvider(botConfig.rpcUrl));
    const rootPc = await PersistenceContext.create();
    const runners: Promise<void>[] = [];
    for (const chainConfig of botConfig.chains) {
        const assetContext = await createAssetContext(botConfig, chainConfig);
        const pc = rootPc.clone();
        const chainRunner = new PersistentAgentRunner(assetContext, pc);
        runners.push(chainRunner.run());
    }
    await Promise.all(runners);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
}).finally(() => {
    process.exit(0);
})
