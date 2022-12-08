import { time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import fs from "fs";
import { ChainContracts, newContract } from "../../src/config/contracts";
import { IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { AssetManagerSettings } from "../../src/fasset/AssetManagerTypes";
import { NativeChainInfo } from "../../src/fasset/ChainInfo";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { MockIndexer } from "../../src/mock/MockIndexer";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { AttestationHelper } from "../../src/underlying-chain/AttestationHelper";
import { UnderlyingChainEvents } from "../../src/underlying-chain/UnderlyingChainEvents";
import { artifacts } from "../../src/utils/artifacts";
import { toBNExp, ZERO_ADDRESS } from "../../src/utils/helpers";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { createTestWalletClient } from "../../test/utils/test-bot-config";
import { TestChainInfo } from "../../test/utils/TestChainInfo";
import { newAssetManager } from "./new-asset-manager";

const AgentVaultFactory = artifacts.require('AgentVaultFactory');
const AttestationClient = artifacts.require('AttestationClientSC');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');
const FtsoManagerMock = artifacts.require('FtsoManagerMock');
const StateConnector = artifacts.require('StateConnectorMock');
const GovernanceSettings = artifacts.require('GovernanceSettings');
const VPContract = artifacts.require('VPContract');

const GENESIS_GOVERNANCE = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";

const ftsoList: Array<[string, string, number]> = [
    ['NAT', 'FtsoNat', 0.20],
    ['ALGO', 'FtsoAlgo', 0.30],
    ['BTC', 'FtsoBtc', 20_000],
    ['DOGE', 'FtsoDoge', 0.05],
    ['LTC', 'FtsoLtc', 50],
    ['XRP', 'FtsoXrp', 0.50],
];
const ftsoDict = Object.fromEntries(ftsoList.map(a => [a[0], a]));

const nativeChainInfo: NativeChainInfo = {
    finalizationBlocks: 0,
    readLogsChunkSize: 10,
};

export async function createTestAssetContext(governance: string, chainInfo: TestChainInfo): Promise<IAssetBotContext> {
    // create governance settings
    const governanceSettings = await GovernanceSettings.new();
    await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE });
    // create state connector
    const stateConnector = await StateConnector.new();
    // create agent vault factory
    const agentVaultFactory = await AgentVaultFactory.new();
    // create attestation client
    const attestationClient = await AttestationClient.new(stateConnector.address);
    // create asset manager controller
    const addressUpdater = await AddressUpdater.new(governance);  // don't switch to production
    const assetManagerController = await AssetManagerController.new(governanceSettings.address, governance, addressUpdater.address);
    await assetManagerController.switchToProductionMode({ from: governance });
    // create WNat token
    const wnat = await WNat.new(governance, "Wrapped Native", "WNAT");
    const vpContract = await VPContract.new(wnat.address, false);
    await wnat.setWriteVpContract(vpContract.address, { from: governance });
    await wnat.setReadVpContract(vpContract.address, { from: governance });
    // create NAT ftso
    const natFtso = await FtsoMock.new("NAT");
    await natFtso.setCurrentPrice(toBNExp(ftsoDict["NAT"][2], 5), 0);
    // create ftso registry
    const ftsoRegistry = await FtsoRegistryMock.new();
    await ftsoRegistry.addFtso(natFtso.address);
    const ftsoManager = await FtsoManagerMock.new();
    // set contracts
    const contracts: ChainContracts = {
        GovernanceSettings: newContract('GovernanceSettings', 'GovernanceSettings.sol', governanceSettings.address),
        AddressUpdater: newContract('AddressUpdater', 'AddressUpdater.sol', addressUpdater.address),
        StateConnector: newContract('StateConnector', 'StateConnectorMock.sol', stateConnector.address),
        WNat: newContract('WNat', 'WNat.sol', wnat.address),
        FtsoRegistry: newContract('FtsoRegistry', 'FtsoRegistryMock.sol', ftsoRegistry.address),
        FtsoManager: newContract('FtsoManager', 'FtsoManagerMock.sol', ftsoManager.address),
        AttestationClient: newContract('AttestationClient', 'AttestationClientSC.sol', attestationClient.address),
        AgentVaultFactory: newContract('AgentVaultFactory', 'AgentVaultFactory.sol', agentVaultFactory.address),
        AssetManagerController: newContract('AssetManagerController', 'AssetManagerController.sol', assetManagerController.address),
    };
    // create mock chain attestation provider
    const chain = new MockChain(await time.latest());
    chain.finalizationBlocks = chainInfo.finalizationBlocks;
    chain.secondsPerBlock = chainInfo.blockTime;
    const chainEventsRaw = chain;
    const chainEvents = new UnderlyingChainEvents(chain, chainEventsRaw, null);
    const stateConnectorClient = new MockStateConnectorClient(stateConnector, 'auto');
    stateConnectorClient.addChain(chainInfo.chainId, chain);
    const attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainInfo.chainId);
    const wallet = new MockChainWallet(chain);
    // create asset FTSO and set some price
    const assetFtso = await FtsoMock.new(chainInfo.symbol);
    await assetFtso.setCurrentPrice(toBNExp(ftsoDict[chainInfo.symbol][2], 5), 0);
    await ftsoRegistry.addFtso(assetFtso.address);
    // create asset manager
    const parameterFilename = `../fasset/deployment/config/hardhat/f-${chainInfo.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    const settings = createAssetManagerSettings(contracts, parameters);
    // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
    const [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, chainInfo.name, chainInfo.symbol, chainInfo.decimals, web3DeepNormalize(settings));
    // indexer
    const blockChainIndexerClient = new MockIndexer("", chainInfo.chainId, createTestWalletClient(chainInfo.chainId), chain);
    // return context
    return { nativeChainInfo, chainInfo, chain, chainEvents, wallet, attestationProvider, assetManager, assetManagerController, ftsoRegistry, ftsoManager, wnat, fAsset, natFtso, assetFtso, blockChainIndexerClient };
}

function bnToString(x: BN | number | string) {
    if (!BN.isBN(x)) {
        x = new BN(x);  // convert to BN to remove spaces etc.
    }
    return x.toString(10);
}

function createAssetManagerSettings(contracts: ChainContracts, parameters: any): AssetManagerSettings {
    if (!contracts.AssetManagerController || !contracts.AgentVaultFactory || !contracts.AttestationClient) {
        throw new Error("Missing contracts");
    }
    return {
        assetManagerController: contracts.AssetManagerController.address,
        agentVaultFactory: contracts.AgentVaultFactory.address,
        whitelist: contracts.AssetManagerWhitelist?.address ?? ZERO_ADDRESS,
        attestationClient: contracts.AttestationClient.address,
        wNat: contracts.WNat.address,
        ftsoRegistry: contracts.FtsoRegistry.address,
        natFtsoIndex: 0,        // set by contract constructor
        assetFtsoIndex: 0,      // set by contract constructor
        natFtsoSymbol: parameters.natSymbol,
        assetFtsoSymbol: parameters.assetSymbol,
        burnAddress: parameters.burnAddress,
        burnWithSelfDestruct: parameters.burnWithSelfDestruct,
        chainId: bnToString(parameters.chainId),
        collateralReservationFeeBIPS: bnToString(parameters.collateralReservationFeeBIPS),
        assetUnitUBA: bnToString(new BN(10).pow(new BN(parameters.assetDecimals))),
        assetMintingGranularityUBA: bnToString(parameters.assetMintingGranularityUBA),
        lotSizeAMG: bnToString(new BN(parameters.lotSize).div(new BN(parameters.assetMintingGranularityUBA))),
        maxTrustedPriceAgeSeconds: bnToString(parameters.maxTrustedPriceAgeSeconds),
        requireEOAAddressProof: parameters.requireEOAAddressProof,
        minCollateralRatioBIPS: bnToString(parameters.minCollateralRatioBIPS),
        ccbMinCollateralRatioBIPS: bnToString(parameters.ccbMinCollateralRatioBIPS),
        safetyMinCollateralRatioBIPS: bnToString(parameters.safetyMinCollateralRatioBIPS),
        underlyingBlocksForPayment: bnToString(parameters.underlyingBlocksForPayment),
        underlyingSecondsForPayment: bnToString(parameters.underlyingSecondsForPayment),
        redemptionFeeBIPS: bnToString(parameters.redemptionFeeBIPS),
        redemptionDefaultFactorBIPS: bnToString(parameters.redemptionDefaultFactorBIPS),
        confirmationByOthersAfterSeconds: bnToString(parameters.confirmationByOthersAfterSeconds),
        confirmationByOthersRewardNATWei: bnToString(parameters.confirmationByOthersRewardNATWei),
        maxRedeemedTickets: bnToString(parameters.maxRedeemedTickets),
        paymentChallengeRewardBIPS: bnToString(parameters.paymentChallengeRewardBIPS),
        paymentChallengeRewardNATWei: bnToString(parameters.paymentChallengeRewardNATWei),
        withdrawalWaitMinSeconds: bnToString(parameters.withdrawalWaitMinSeconds),
        liquidationCollateralFactorBIPS: parameters.liquidationCollateralFactorBIPS.map(bnToString),
        ccbTimeSeconds: bnToString(parameters.ccbTimeSeconds),
        liquidationStepSeconds: bnToString(parameters.liquidationStepSeconds),
        attestationWindowSeconds: bnToString(parameters.attestationWindowSeconds),
        minUpdateRepeatTimeSeconds: bnToString(parameters.minUpdateRepeatTimeSeconds),
        buybackCollateralFactorBIPS: bnToString(parameters.buybackCollateralFactorBIPS),
        announcedUnderlyingConfirmationMinSeconds: bnToString(parameters.announcedUnderlyingConfirmationMinSeconds),
    };
}
