import { time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import fs, { readFileSync } from "fs";
import { AgentSettingsConfig } from "../../src/config/BotConfig";
import { ChainContracts, newContract } from "../../src/config/contracts";
import { AgentBotSettings, IAssetBotContext } from "../../src/fasset-bots/IAssetBotContext";
import { AssetManagerSettings, CollateralToken, CollateralTokenClass } from "../../src/fasset/AssetManagerTypes";
import { NativeChainInfo } from "../../src/fasset/ChainInfo";
import { encodeLiquidationStrategyImplSettings, LiquidationStrategyImplSettings } from "../../src/fasset/LiquidationStrategyImpl";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { MockIndexer } from "../../src/mock/MockIndexer";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { AttestationHelper } from "../../src/underlying-chain/AttestationHelper";
import { artifacts } from "../../src/utils/artifacts";
import { DAYS, HOURS, MINUTES, Modify, requireEnv, toBIPS, toBN, toBNExp, ZERO_ADDRESS } from "../../src/utils/helpers";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { TestChainInfo } from "../../test/test-utils/TestChainInfo";
import { FtsoManagerMockInstance, FtsoMockInstance, FtsoRegistryMockInstance } from "../../typechain-truffle";
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
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const ERC20Mock = artifacts.require("ERC20Mock");
const TrivialAddressValidatorMock = artifacts.require('TrivialAddressValidatorMock');

const GENESIS_GOVERNANCE = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";
const DEFAULT_AGENT_SETTINGS_PATH: string = requireEnv('DEFAULT_AGENT_SETTINGS_PATH');

export type TestFtsos = Record<'nat' | 'usdc' | 'usdt' | 'asset', FtsoMockInstance>;

const nativeChainInfo: NativeChainInfo = {
    finalizationBlocks: 0,
    readLogsChunkSize: 10,
};

export type TestAssetBotContext = Modify<IAssetBotContext, {
    natFtso: FtsoMockInstance;
    assetFtso: FtsoMockInstance;
    ftsoManager: FtsoManagerMockInstance;
    chain: MockChain;
}>

export async function createTestAssetContext(governance: string, chainInfo: TestChainInfo, requireEOAAddressProof?: boolean, customParameters?: any): Promise<TestAssetBotContext> {
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
    const wNat = await WNat.new(governance, "Wrapped Native", "WNAT");
    const vpContract = await VPContract.new(wNat.address, false);
    await wNat.setWriteVpContract(vpContract.address, { from: governance });
    await wNat.setReadVpContract(vpContract.address, { from: governance });
    // create ftso registry
    const ftsoRegistry = await FtsoRegistryMock.new();
    // await ftsoRegistry.addFtso(natFtso.address);
    const ftsoManager = await FtsoManagerMock.new();
    // create collateral pool factory
    const collateralPoolFactory = await CollateralPoolFactory.new();
    // create address validator
    const addressValidator = await TrivialAddressValidatorMock.new();
    // create liquidation strategy
    const liquidationStrategyLib = await artifacts.require("LiquidationStrategyImpl").new();
    const liquidationStrategy = liquidationStrategyLib.address;
    // set contracts
    const contracts: ChainContracts = {
        GovernanceSettings: newContract('GovernanceSettings', 'GovernanceSettings.sol', governanceSettings.address),
        AddressUpdater: newContract('AddressUpdater', 'AddressUpdater.sol', addressUpdater.address),
        StateConnector: newContract('StateConnector', 'StateConnectorMock.sol', stateConnector.address),
        WNat: newContract('WNat', 'WNat.sol', wNat.address),
        FtsoRegistry: newContract('FtsoRegistry', 'FtsoRegistryMock.sol', ftsoRegistry.address),
        FtsoManager: newContract('FtsoManager', 'FtsoManagerMock.sol', ftsoManager.address),
        AttestationClient: newContract('AttestationClient', 'AttestationClientSC.sol', attestationClient.address),
        AgentVaultFactory: newContract('AgentVaultFactory', 'AgentVaultFactory.sol', agentVaultFactory.address),
        AssetManagerController: newContract('AssetManagerController', 'AssetManagerController.sol', assetManagerController.address),
        CollateralPoolFactory: newContract('CollateralPoolFactory', 'CollateralPoolFactory.sol', collateralPoolFactory.address),
        TrivialAddressValidatorMock: newContract('TrivialAddressValidatorMock', 'TrivialAddressValidatorMock.sol', addressValidator.address)
    };
    // create mock chain attestation provider
    const chain = new MockChain(await time.latest());
    chain.finalizationBlocks = chainInfo.finalizationBlocks;
    chain.secondsPerBlock = chainInfo.blockTime;
    const stateConnectorClient = new MockStateConnectorClient(stateConnector, 'auto');
    stateConnectorClient.addChain(chainInfo.chainId, chain);
    const attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainInfo.chainId);
    const wallet = new MockChainWallet(chain);
    // create stablecoins
    const stablecoins = {
        usdc: await ERC20Mock.new("USDCoin", "USDC"),
        usdt: await ERC20Mock.new("Tether", "USDT"),
    };
    // ftsos
    const ftsos = await createTestFtsos(ftsoRegistry, chainInfo);
    // collaterals
    const collaterals = createTestCollaterals(contracts, stablecoins);
    // create asset manager
    const parameterFilename = `../fasset/deployment/config/hardhat/f-${chainInfo.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    if (typeof requireEOAAddressProof !== 'undefined') parameters.requireEOAAddressProof = requireEOAAddressProof
    const settings = createAssetManagerSettings(contracts, customParameters ? customParameters : parameters, liquidationStrategy);
    // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
    const [assetManager, fAsset] = await newAssetManager(governance, assetManagerController, chainInfo.name, chainInfo.symbol, chainInfo.decimals, web3DeepNormalize(settings), collaterals, createEncodedTestLiquidationSettings());
    // indexer
    const blockChainIndexerClient = new MockIndexer("", chainInfo.chainId, chain);
    //
    const natFtsoSymbol: string = collaterals[0].ftsoSymbol;
    const natFtso = await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol(natFtsoSymbol));
    const assetFtso = await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol(settings.assetFtsoSymbol));
    // return context
    return { nativeChainInfo, chainInfo, chain, wallet, attestationProvider, assetManager, assetManagerController, ftsoRegistry, ftsoManager, wNat, fAsset, natFtso, assetFtso, blockChainIndexerClient, stablecoins, collaterals, ftsos };
}

function bnToString(x: BN | number | string) {
    if (!BN.isBN(x)) {
        x = new BN(x);  // convert to BN to remove spaces etc.
    }
    return x.toString(10);
}

function createAssetManagerSettings(contracts: ChainContracts, parameters: any, liquidationStrategy: string): AssetManagerSettings {
    if (!contracts.AssetManagerController || !contracts.AgentVaultFactory || !contracts.AttestationClient) {
        throw new Error("Missing contracts");
    }
    return {
        assetManagerController: contracts.AssetManagerController.address,
        agentVaultFactory: contracts.AgentVaultFactory.address,
        whitelist: contracts.AssetManagerWhitelist?.address ?? ZERO_ADDRESS,
        attestationClient: contracts.AttestationClient.address,
        ftsoRegistry: contracts.FtsoRegistry.address,
        assetFtsoIndex: 0,      // set by contract constructor
        assetFtsoSymbol: parameters.assetSymbol,
        burnAddress: parameters.burnAddress,
        burnWithSelfDestruct: parameters.burnWithSelfDestruct,
        chainId: bnToString(parameters.chainId),
        collateralReservationFeeBIPS: bnToString(parameters.collateralReservationFeeBIPS),
        assetMintingGranularityUBA: bnToString(toBNExp(1, parameters.assetDecimals - parameters.assetMintingDecimals)),
        lotSizeAMG: bnToString(toBNExp(parameters.lotSize, parameters.assetMintingDecimals)),
        maxTrustedPriceAgeSeconds: bnToString(parameters.maxTrustedPriceAgeSeconds),
        requireEOAAddressProof: parameters.requireEOAAddressProof,
        underlyingBlocksForPayment: bnToString(parameters.underlyingBlocksForPayment),
        underlyingSecondsForPayment: bnToString(parameters.underlyingSecondsForPayment),
        redemptionFeeBIPS: bnToString(parameters.redemptionFeeBIPS),
        confirmationByOthersAfterSeconds: bnToString(parameters.confirmationByOthersAfterSeconds),
        maxRedeemedTickets: bnToString(parameters.maxRedeemedTickets),
        paymentChallengeRewardBIPS: bnToString(parameters.paymentChallengeRewardBIPS),
        withdrawalWaitMinSeconds: bnToString(parameters.withdrawalWaitMinSeconds),
        ccbTimeSeconds: bnToString(parameters.ccbTimeSeconds),
        attestationWindowSeconds: bnToString(parameters.attestationWindowSeconds),
        minUpdateRepeatTimeSeconds: bnToString(parameters.minUpdateRepeatTimeSeconds),
        buybackCollateralFactorBIPS: bnToString(parameters.buybackCollateralFactorBIPS),
        announcedUnderlyingConfirmationMinSeconds: bnToString(parameters.announcedUnderlyingConfirmationMinSeconds),

        fAsset: ZERO_ADDRESS, //TODO
        collateralPoolFactory: contracts.CollateralPoolFactory!.address,
        underlyingAddressValidator: contracts.TrivialAddressValidatorMock!.address,
        liquidationStrategy: liquidationStrategy,
        agentWhitelist: contracts.agentWhitelist?.address ?? ZERO_ADDRESS,
        assetUnitUBA: toBNExp(1, parameters.assetDecimals),
        assetDecimals: parameters.assetDecimals,
        assetMintingDecimals: parameters.assetMintingDecimals,
        mintingCapAMG: 0,                                   // minting cap disabled
        redemptionDefaultFactorAgentC1BIPS: toBIPS(1.1),
        redemptionDefaultFactorPoolBIPS: toBIPS(0.1),
        confirmationByOthersRewardUSD5: toBNExp(100, 5),        // 100 USD
        paymentChallengeRewardUSD5: toBNExp(300, 5),            // 300 USD
        agentFeeChangeTimelockSeconds: 6 * HOURS,
        agentCollateralRatioChangeTimelockSeconds: 1 * HOURS,
        agentExitAvailableTimelockSeconds: 10 * MINUTES,
        class1BuyForFlareFactorBIPS: toBIPS(1.05),
        mintingPoolHoldingsRequiredBIPS: toBIPS("50%"),
        tokenInvalidationTimeMinSeconds: 1 * DAYS
    };
}

export function createTestCollaterals(contracts: ChainContracts, stableCoins: any): CollateralToken[] {
    const poolCollateral: CollateralToken = {
        tokenClass: CollateralTokenClass.POOL,
        token: contracts.WNat!.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        ftsoSymbol: "NAT",
        minCollateralRatioBIPS: toBIPS(2.0),
        ccbMinCollateralRatioBIPS: toBIPS(1.9),
        safetyMinCollateralRatioBIPS: toBIPS(2.1),
    };
    const usdcCollateral: CollateralToken = {
        tokenClass: CollateralTokenClass.CLASS1,
        token: stableCoins.usdc.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        ftsoSymbol: "USDC",
        minCollateralRatioBIPS: toBIPS(1.4),
        ccbMinCollateralRatioBIPS: toBIPS(1.3),
        safetyMinCollateralRatioBIPS: toBIPS(1.5),
    };
    const usdtCollateral: CollateralToken = {
        tokenClass: CollateralTokenClass.CLASS1,
        token: stableCoins.usdt.address,
        decimals: 18,
        validUntil: 0,  // not deprecated
        ftsoSymbol: "USDT",
        minCollateralRatioBIPS: toBIPS(1.5),
        ccbMinCollateralRatioBIPS: toBIPS(1.4),
        safetyMinCollateralRatioBIPS: toBIPS(1.6),
    };
    return [poolCollateral, usdcCollateral, usdtCollateral];
}

export async function createFtsoMock(ftsoRegistry: FtsoRegistryMockInstance, ftsoSymbol: string, initialPrice: number, decimals: number = 5): Promise<FtsoMockInstance> {
    const ftso = await FtsoMock.new(ftsoSymbol, decimals);
    await ftso.setCurrentPrice(toBNExp(initialPrice, decimals), 0);
    await ftso.setCurrentPriceFromTrustedProviders(toBNExp(initialPrice, decimals), 0);
    await ftsoRegistry.addFtso(ftso.address);
    return ftso;
}

export async function createTestFtsos(ftsoRegistry: FtsoRegistryMockInstance, assetChainInfo: TestChainInfo): Promise<TestFtsos> {
    return {
        nat: await createFtsoMock(ftsoRegistry, "NAT", 0.42),
        usdc: await createFtsoMock(ftsoRegistry, "USDC", 1.01),
        usdt: await createFtsoMock(ftsoRegistry, "USDT", 0.99),
        asset: await createFtsoMock(ftsoRegistry, assetChainInfo.symbol, assetChainInfo.startPrice),
    };
}

export function createTestLiquidationSettings(): LiquidationStrategyImplSettings {
    return {
        liquidationStepSeconds: 90,
        liquidationCollateralFactorBIPS: [toBIPS(1.2), toBIPS(1.6), toBIPS(2.0)],
        liquidationFactorClass1BIPS: [toBIPS(1), toBIPS(1), toBIPS(1)],
    };
}

export function createEncodedTestLiquidationSettings() {
    return encodeLiquidationStrategyImplSettings(createTestLiquidationSettings());
}

export async function createTestAgentBotSettings(context: TestAssetBotContext): Promise<AgentBotSettings> {
    const agentSettingsConfig = JSON.parse(readFileSync(DEFAULT_AGENT_SETTINGS_PATH).toString()) as AgentSettingsConfig;
    const class1Token = (await context.assetManager.getCollateralTokens()).find(token => {
        return Number(token.tokenClass) === CollateralTokenClass.CLASS1 && token.ftsoSymbol === agentSettingsConfig.class1FtsoSymbol
    });
    if (!class1Token) {
        throw Error(`Invalid class1 collateral token ${agentSettingsConfig.class1FtsoSymbol}`);
    }
    const poolToken = (await context.assetManager.getCollateralTokens()).find(token => {
        return Number(token.tokenClass) === CollateralTokenClass.POOL && token.ftsoSymbol === "NAT"
    });
    if (!poolToken) {
        throw Error(`Cannot find pool collateral token`);
    }
    const agentBotSettings: AgentBotSettings = {
        class1CollateralToken: class1Token.token,
        feeBIPS: toBN(agentSettingsConfig.feeBIPS),
        poolFeeShareBIPS: toBN(agentSettingsConfig.poolFeeShareBIPS),
        mintingClass1CollateralRatioBIPS: toBN(class1Token.minCollateralRatioBIPS).muln(agentSettingsConfig.mintingClass1CollateralRatioConstant),
        mintingPoolCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.mintingPoolCollateralRatioConstant),
        poolExitCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.poolExitCollateralRatioConstant),
        buyFAssetByAgentFactorBIPS: toBN(agentSettingsConfig.buyFAssetByAgentFactorBIPS),
        poolTopupCollateralRatioBIPS: toBN(poolToken.minCollateralRatioBIPS).muln(agentSettingsConfig.poolTopupCollateralRatioConstant),
        poolTopupTokenPriceFactorBIPS: toBN(agentSettingsConfig.poolTopupTokenPriceFactorBIPS)
    };
    return agentBotSettings;
}