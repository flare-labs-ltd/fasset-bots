import { time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import fs from "fs";
import { ChainId, TimekeeperTimingConfig } from "../../src";
import { Secrets } from "../../src/config";
import { ChainAccount, SecretsFile } from "../../src/config/config-files/SecretsFile";
import { ChainContracts, newContract } from "../../src/config/contracts";
import { IAssetAgentContext, IAssetNativeChainContext, IERC20Events } from "../../src/fasset-bots/IAssetBotContext";
import { CollateralClass, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { ChainInfo } from "../../src/fasset/ChainInfo";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { MockFlareDataConnectorClient } from "../../src/mock/MockFlareDataConnectorClient";
import { MockIndexer } from "../../src/mock/MockIndexer";
import { MockVerificationApiClient } from "../../src/mock/MockVerificationApiClient";
import { AttestationHelper } from "../../src/underlying-chain/AttestationHelper";
import { FDC_PROTOCOL_ID } from "../../src/underlying-chain/interfaces/IFlareDataConnectorClient";
import { ContractWithEvents } from "../../src/utils/events/truffle";
import { BNish, DAYS, HOURS, MAX_BIPS, MINUTES, Modify, requireNotNull, toBIPS, toBNExp, WEEKS, ZERO_ADDRESS } from "../../src/utils/helpers";
import { artifacts } from "../../src/utils/web3";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { testChainInfo, TestChainInfo, testNativeChainInfo } from "../../test/test-utils/TestChainInfo";
import { AddressUpdaterInstance, AssetManagerControllerInstance, FakeERC20Instance, FtsoV2PriceStoreMockInstance, IIAssetManagerInstance } from "../../typechain-truffle";
import { FaultyWallet } from "./FaultyWallet";
import { AssetManagerInitSettings, newAssetManager, newAssetManagerController, waitForTimelock } from "./new-asset-manager";

const AgentVault = artifacts.require("AgentVault");
const AgentVaultFactory = artifacts.require("AgentVaultFactory");
const FdcVerification = artifacts.require("FdcVerificationMock");
const AssetManagerController = artifacts.require("AssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
const WNat = artifacts.require("WNat");
const Relay = artifacts.require("RelayMock");
const FdcHub = artifacts.require("FdcHubMock");
const GovernanceSettings = artifacts.require("GovernanceSettings");
const VPContract = artifacts.require("VPContract");
const CollateralPool = artifacts.require("CollateralPool");
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const CollateralPoolToken = artifacts.require("CollateralPoolToken");
const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");
const FakeERC20 = artifacts.require("FakeERC20");
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");
const FtsoV2PriceStoreMock = artifacts.require("FtsoV2PriceStoreMock");
const IPriceChangeEmitter = artifacts.require("IPriceChangeEmitter");
const CoreVaultManager = artifacts.require('CoreVaultManager');
const CoreVaultManagerProxy = artifacts.require('CoreVaultManagerProxy');

export type AssetManagerControllerEvents = import("../../typechain-truffle/AssetManagerController").AllEvents;
export type FtsoV2PriceStoreMockEvents = import("../../typechain-truffle/FtsoV2PriceStoreMock").AllEvents;

const GENESIS_GOVERNANCE = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";

export const ftsoNatInitialPrice = 0.42;
export const ftsoUsdcInitialPrice = 1.01;
export const ftsoUsdtInitialPrice = 0.99;
export const ftsoEthInitialPrice = 2000;

export type TestAssetBotContext = Modify<
    IAssetAgentContext,
    {
        blockchainIndexer: MockIndexer;
        assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
        stablecoins: Record<string, ContractWithEvents<FakeERC20Instance, IERC20Events>>;
        collaterals: CollateralType[];
        priceStore: ContractWithEvents<FtsoV2PriceStoreMockInstance, FtsoV2PriceStoreMockEvents>;
    }
>;

export type TestAssetTrackedStateContext = Modify<
    IAssetNativeChainContext,
    {
        attestationProvider: AttestationHelper;
        blockchainIndexer: MockIndexer;
        stablecoins: Record<string, ContractWithEvents<FakeERC20Instance, IERC20Events>>;
        collaterals: CollateralType[];
        priceStore: ContractWithEvents<FtsoV2PriceStoreMockInstance, FtsoV2PriceStoreMockEvents>;
        liquidationStrategy?: { className: string; config?: any; };
        challengeStrategy?: { className: string; config?: any; };
    }
>;

export async function createTestChainContracts(governance: string, updateExecutor?: string, supportedChains: Record<string, TestChainInfo> = testChainInfo) {
    // create governance settings
    const governanceSettings = await GovernanceSettings.new();
    await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE });
    // add update executors
    if (updateExecutor) {
        await governanceSettings.setExecutors([governance, updateExecutor], { from: governance });
    }
    // create flare data connector
    const relay = await Relay.new();
    const fdcHub = await FdcHub.new();
    // create agent vault factory
    const agentVaultImplementation = await AgentVault.new(ZERO_ADDRESS);
    const agentVaultFactory = await AgentVaultFactory.new(agentVaultImplementation.address);
    // create collateral pool factory
    const collateralPoolImplementation = await CollateralPool.new(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, 0, 0, 0);
    const collateralPoolFactory = await CollateralPoolFactory.new(collateralPoolImplementation.address);
    // create collateral pool token factory
    const collateralPoolTokenImplementation = await CollateralPoolToken.new(ZERO_ADDRESS, "", "");
    const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new(collateralPoolTokenImplementation.address);
    // create attestation client
    const fdcVerification = await FdcVerification.new(relay.address, FDC_PROTOCOL_ID);
    // create WNat token
    const wNat = await WNat.new(governance, "Wrapped Native", "WNAT");
    const vpContract = await VPContract.new(wNat.address, false);
    await wNat.setWriteVpContract(vpContract.address, { from: governance });
    await wNat.setReadVpContract(vpContract.address, { from: governance });
    // create stablecoins
    const testUSDC = await FakeERC20.new(governanceSettings.address, governance, "Test USDCoin", "testUSDC", 6);
    const testUSDT = await FakeERC20.new(governanceSettings.address, governance, "Test Tether", "testUSDT", 6);
    const testETH = await FakeERC20.new(governanceSettings.address, governance, "Test Ethereum", "testETH", 18);
    // create address updater
    const addressUpdater = await AddressUpdater.new(governance); // don't switch to production
    // create asset manager controller
    const assetManagerController = await newAssetManagerController(governanceSettings.address, governance, addressUpdater.address)
    await assetManagerController.switchToProductionMode({ from: governance });
    // create ftsov2 price store
    const priceStore = await createMockFtsoV2PriceStore(governanceSettings.address, governance, addressUpdater.address, supportedChains);
    // create allow-all agent owner registry
    const agentOwnerRegistry = await AgentOwnerRegistry.new(governanceSettings.address, governance, true);
    await agentOwnerRegistry.setAllowAll(true, { from: governance });
    // add some contracts to address updater
    await addressUpdater.addOrUpdateContractNamesAndAddresses(
        ["GovernanceSettings", "AddressUpdater", "FdcHub", "Relay", "FdcVerification", "WNat"],
        [governanceSettings.address, addressUpdater.address, fdcHub.address, relay.address, fdcVerification.address, wNat.address],
        { from: governance });
    // set contracts
    const contracts: ChainContracts = {
        GovernanceSettings: newContract("GovernanceSettings", "GovernanceSettings.sol", governanceSettings.address),
        AddressUpdater: newContract("AddressUpdater", "AddressUpdater.sol", addressUpdater.address),
        Relay: newContract("Relay", "Relay.sol", relay.address),
        FdcHub: newContract("FdcHub", "FdcHubMock.sol", fdcHub.address),
        WNat: newContract("WNat", "WNat.sol", wNat.address),
        FdcVerification: newContract("FdcVerification", "FdcVerification.sol", fdcVerification.address),
        AgentVaultFactory: newContract("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address),
        AssetManagerController: newContract("AssetManagerController", "AssetManagerController.sol", assetManagerController.address),
        CollateralPoolFactory: newContract("CollateralPoolFactory", "CollateralPoolFactory.sol", collateralPoolFactory.address),
        AgentOwnerRegistry: newContract("AgentOwnerRegistry", "AgentOwnerRegistry.sol", agentOwnerRegistry.address),
        CollateralPoolTokenFactory: newContract("CollateralPoolTokenFactory", "CollateralPoolTokenFactory.sol", collateralPoolTokenFactory.address),
        PriceReader: newContract("PriceReader", "PriceReader.sol", priceStore.address),
        TestUSDC: newContract("TestUSDC", "FakeERC20.sol", testUSDC.address),
        TestUSDT: newContract("TestUSDT", "FakeERC20.sol", testUSDT.address),
        TestETH: newContract("TestETH", "FakeERC20.sol", testETH.address),
        FtsoV2PriceStore: newContract("FtsoV2PriceStore", "FtsoV2PriceStore.sol", priceStore.address),
    };
    return contracts;
}

export async function createMockFtsoV2PriceStore(governanceSettingsAddress: string, initialGovernance: string, addressUpdater: string, assetChainInfos: Record<string, TestChainInfo>) {
    const currentTime = await time.latest();
    const votingEpochDurationSeconds = 90;
    const firstVotingRoundStartTs = currentTime.toNumber() - 1 * WEEKS;
    const ftsoScalingProtocolId = 100;
    // create store
    const priceStore = await FtsoV2PriceStoreMock.new(governanceSettingsAddress, initialGovernance, addressUpdater,
        firstVotingRoundStartTs, votingEpochDurationSeconds, ftsoScalingProtocolId);
    // setup
    const feedIdArr = ["0xc1", "0xc2", "0xc3", "0xc4"];
    const symbolArr = ["NAT", "testUSDC", "testUSDT", "testETH"];
    const decimalsArr = [5, 5, 5, 5];
    for (const [i, ci] of Object.values(assetChainInfos).entries()) {
        feedIdArr.push(`0xa${i + 1}`);
        symbolArr.push(ci.symbol);
        decimalsArr.push(5);
    }
    await priceStore.updateSettings(feedIdArr, symbolArr, decimalsArr, 100, { from: initialGovernance });
    // init prices
    async function setInitPrice(symbol: string, price: number | string) {
        const decimals = requireNotNull(decimalsArr[symbolArr.indexOf(symbol)]);
        await priceStore.setCurrentPrice(symbol, toBNExp(price, decimals), 0);
        await priceStore.setCurrentPriceFromTrustedProviders(symbol, toBNExp(price, decimals), 0);
    }
    await setInitPrice("NAT", ftsoNatInitialPrice);
    await setInitPrice("testUSDC", ftsoUsdcInitialPrice);
    await setInitPrice("testUSDT", ftsoUsdtInitialPrice);
    await setInitPrice("testETH", ftsoEthInitialPrice);
    for (const ci of Object.values(assetChainInfos)) {
        await setInitPrice(ci.symbol, ci.startPrice);
    }
    //
    return priceStore;
}

export async function createTestChain(chainInfo: TestChainInfo) {
    const chain = new MockChain(await time.latest());
    chain.finalizationBlocks = chainInfo.finalizationBlocks;
    chain.secondsPerBlock = chainInfo.blockTime;
    return chain;
}

type CreateTestAssetContextOptions = {
    contracts?: ChainContracts;
    requireEOAAddressProof?: boolean;
    customParameters?: any;
    updateExecutor?: string;
    useAlwaysFailsProver?: boolean;
    assetManagerControllerAddress?: string;
    useFaultyWallet?: boolean;
    chain?: MockChain;
    flareDataConnectorClient?: MockFlareDataConnectorClient;
    flareDataConnectorSubmitterAccount?: string;
    coreVaultUnderlyingAddress?: string;    // set address to enable core vault functionality
};

export async function createTestAssetContext(
    governance: string,
    chainInfo: TestChainInfo,
    options: CreateTestAssetContextOptions = {}
): Promise<TestAssetBotContext> {
    const contracts = options.contracts ?? await createTestChainContracts(governance, options.updateExecutor);
    // contract wrappers
    const relay = await Relay.at(contracts.Relay.address);
    const fdcHub = await FdcHub.at(contracts.FdcHub.address);
    const assetManagerController = await AssetManagerController.at(contracts.AssetManagerController.address);
    const wNat = await WNat.at(contracts.WNat.address);
    const addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
    const agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry.address);
    // stablecoins
    const stablecoins = {
        usdc: await FakeERC20.at(contracts.TestUSDC!.address),
        usdt: await FakeERC20.at(contracts.TestUSDT!.address),
        eth: await FakeERC20.at(contracts.TestETH!.address),
    };
    // price change emitter
    const priceChangeEmitter = await IPriceChangeEmitter.at(contracts.FtsoV2PriceStore.address);
    const priceStore = await FtsoV2PriceStoreMock.at(contracts.FtsoV2PriceStore.address);
    // create mock chain attestation provider
    const chain = options.chain ?? await createTestChain(chainInfo);
    const flareDataConnectorClient = options.flareDataConnectorClient
        ?? new MockFlareDataConnectorClient(fdcHub, relay, {}, "auto", options.flareDataConnectorSubmitterAccount, options.useAlwaysFailsProver ?? false);
    flareDataConnectorClient.addChain(chainInfo.chainId, chain);
    const verificationClient = new MockVerificationApiClient();
    const attestationProvider = new AttestationHelper(flareDataConnectorClient, chain, chainInfo.chainId);
    const wallet = options.useFaultyWallet ? new FaultyWallet() : new MockChainWallet(chain);
    // collaterals
    const collaterals = createTestCollaterals(contracts, chainInfo, stablecoins);
    // create asset manager
    const parameterFilename = chainInfo.parameterFile ?? `./fasset-config/hardhat/f-${chainInfo.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    const settings = createTestAssetManagerSettings(contracts, options.customParameters ?? parameters, chainInfo, options.requireEOAAddressProof);
    const fAssetName = parameters.fAssetName ?? `F${chainInfo.name}`;
    const fAssetSymbol = parameters.fAssetSymbol ?? `F${chainInfo.symbol}`;
    // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
    const [assetManager, fAsset] = await newAssetManager(governance, options.assetManagerControllerAddress ?? assetManagerController,
        fAssetName, fAssetSymbol, chainInfo.name, chainInfo.symbol, chainInfo.decimals, web3DeepNormalize(settings), collaterals,
        { governanceSettings: contracts.GovernanceSettings.address });
    // create and assign core vault
    const coreVaultManager = options.coreVaultUnderlyingAddress ? await assignCoreVaultManager(assetManager, addressUpdater, options.coreVaultUnderlyingAddress) : undefined;
    // indexer
    const blockchainIndexer = new MockIndexer([""], chainInfo.chainId, chain);
    // return context
    return {
        fAssetSymbol,
        nativeChainInfo: testNativeChainInfo,
        chainInfo,
        blockchainIndexer,
        wallet,
        attestationProvider,
        assetManager,
        assetManagerController,
        wNat,
        fAsset,
        addressUpdater,
        priceChangeEmitter,
        collaterals,
        stablecoins,
        verificationClient,
        agentOwnerRegistry,
        priceStore,
        coreVaultManager,
    };
}

export function createTestSecrets(chains: ChainId[], ownerManagementAddress: string, ownerWorkAddress: string, ownerUnderlyingAddress: string) {
    const secrets: SecretsFile = {
        apiKey: {},
        owner: {
            management: {
                address: ownerManagementAddress,
            } as ChainAccount,
            native: {
                address: ownerWorkAddress,
                private_key: "not_needed",
            },
        }
    };
    for (const chain of chains) {
        secrets.owner![chain.chainName] = {
            address: ownerUnderlyingAddress,
            private_key: "not_needed",
        };
    }
    return new Secrets("MEMORY", secrets);
}

export function getTestAssetTrackedStateContext(context: TestAssetBotContext, useCustomStrategy: boolean = false): TestAssetTrackedStateContext {
    return {
        fAssetSymbol: context.fAssetSymbol,
        nativeChainInfo: context.nativeChainInfo,
        blockchainIndexer: context.blockchainIndexer,
        attestationProvider: context.attestationProvider,
        assetManager: context.assetManager,
        assetManagerController: context.assetManagerController,
        fAsset: context.fAsset,
        wNat: context.wNat,
        addressUpdater: context.addressUpdater,
        priceChangeEmitter: context.priceChangeEmitter,
        collaterals: context.collaterals,
        stablecoins: context.stablecoins,
        agentOwnerRegistry: context.agentOwnerRegistry,
        priceStore: context.priceStore,
        coreVaultManager: context.coreVaultManager,
        liquidationStrategy: useCustomStrategy ? { className: "DefaultLiquidationStrategy" } : undefined,
        challengeStrategy: useCustomStrategy ? { className: "DefaultChallengeStrategy" } : undefined,
    };
}

function bnToString(x: BN | number | string) {
    if (!BN.isBN(x)) {
        x = new BN(x); // convert to BN to remove spaces etc.
    }
    return x.toString(10);
}

function createTestAssetManagerSettings(
    contracts: ChainContracts,
    parameters: any,
    chainInfo: TestChainInfo,
    requireEOAAddressProof?: boolean
): AssetManagerInitSettings {
    if (!contracts.AssetManagerController || !contracts.AgentVaultFactory || !contracts.FdcVerification) {
        throw new Error("Missing contracts");
    }
    return {
        assetManagerController: contracts.AssetManagerController.address,
        fAsset: ZERO_ADDRESS, // replaced in newAssetManager()
        agentVaultFactory: contracts.AgentVaultFactory.address,
        collateralPoolFactory: contracts.CollateralPoolFactory.address,
        collateralPoolTokenFactory: contracts.CollateralPoolTokenFactory.address,
        fdcVerification: contracts.FdcVerification.address,
        priceReader: contracts.PriceReader.address,
        whitelist: contracts.AssetManagerWhitelist?.address ?? ZERO_ADDRESS,
        agentOwnerRegistry: contracts.AgentOwnerRegistry.address ?? ZERO_ADDRESS,
        burnAddress: parameters.burnAddress,
        chainId: chainInfo.chainId.sourceId,
        poolTokenSuffix: parameters.poolTokenSuffix,
        assetDecimals: chainInfo.decimals,
        assetUnitUBA: toBNExp(1, chainInfo.decimals),
        assetMintingDecimals: chainInfo.amgDecimals,
        assetMintingGranularityUBA: toBNExp(1, chainInfo.decimals - chainInfo.amgDecimals),
        minUnderlyingBackingBIPS: MAX_BIPS,
        mintingCapAMG: 0, // minting cap disabled
        lotSizeAMG: toBNExp(chainInfo.lotSize, chainInfo.amgDecimals),
        requireEOAAddressProof: typeof requireEOAAddressProof !== "undefined" ? requireEOAAddressProof : chainInfo.requireEOAProof,
        collateralReservationFeeBIPS: parameters.collateralReservationFeeBIPS,
        mintingPoolHoldingsRequiredBIPS: toBIPS("50%"),
        maxRedeemedTickets: bnToString(parameters.maxRedeemedTickets),
        redemptionFeeBIPS: bnToString(parameters.redemptionFeeBIPS),
        redemptionDefaultFactorVaultCollateralBIPS: toBIPS(1.1),
        redemptionDefaultFactorPoolBIPS: toBIPS(0.1),
        underlyingBlocksForPayment: chainInfo.underlyingBlocksForPayment,
        underlyingSecondsForPayment: chainInfo.underlyingBlocksForPayment,
        attestationWindowSeconds: bnToString(parameters.attestationWindowSeconds),
        averageBlockTimeMS: bnToString(parameters.averageBlockTimeMS),
        confirmationByOthersAfterSeconds: bnToString(parameters.confirmationByOthersAfterSeconds),
        confirmationByOthersRewardUSD5: toBNExp(100, 5), // 100 USD
        paymentChallengeRewardBIPS: bnToString(parameters.paymentChallengeRewardBIPS),
        paymentChallengeRewardUSD5: toBNExp(300, 5), // 300 USD
        ccbTimeSeconds: bnToString(parameters.ccbTimeSeconds),
        maxTrustedPriceAgeSeconds: bnToString(parameters.maxTrustedPriceAgeSeconds),
        withdrawalWaitMinSeconds: bnToString(parameters.withdrawalWaitMinSeconds),
        announcedUnderlyingConfirmationMinSeconds: bnToString(parameters.announcedUnderlyingConfirmationMinSeconds),
        buybackCollateralFactorBIPS: bnToString(parameters.buybackCollateralFactorBIPS),
        vaultCollateralBuyForFlareFactorBIPS: toBIPS(1.05),
        minUpdateRepeatTimeSeconds: bnToString(parameters.minUpdateRepeatTimeSeconds),
        tokenInvalidationTimeMinSeconds: 1 * DAYS,
        agentExitAvailableTimelockSeconds: 10 * MINUTES,
        agentFeeChangeTimelockSeconds: 6 * HOURS,
        agentMintingCRChangeTimelockSeconds: bnToString(parameters.agentMintingCRChangeTimelockSeconds),
        poolExitAndTopupChangeTimelockSeconds: bnToString(parameters.poolExitAndTopupChangeTimelockSeconds),
        agentTimelockedOperationWindowSeconds: bnToString(parameters.agentTimelockedOperationWindowSeconds),
        collateralPoolTokenTimelockSeconds: bnToString(parameters.collateralPoolTokenTimelockSeconds),
        liquidationStepSeconds: bnToString(parameters.liquidationStepSeconds),
        liquidationCollateralFactorBIPS: parameters.liquidationCollateralFactorBIPS.map(bnToString),
        liquidationFactorVaultCollateralBIPS: parameters.liquidationFactorVaultCollateralBIPS.map(bnToString),
        diamondCutMinTimelockSeconds: bnToString(parameters.diamondCutMinTimelockSeconds),
        maxEmergencyPauseDurationSeconds: bnToString(parameters.maxEmergencyPauseDurationSeconds),
        emergencyPauseDurationResetAfterSeconds: bnToString(parameters.emergencyPauseDurationResetAfterSeconds),
        redemptionPaymentExtensionSeconds: bnToString(15),
        cancelCollateralReservationAfterSeconds: 30,
        rejectOrCancelCollateralReservationReturnFactorBIPS: toBIPS(0.95),
        rejectRedemptionRequestWindowSeconds: 120,
        takeOverRedemptionRequestWindowSeconds: 120,
        rejectedRedemptionDefaultFactorVaultCollateralBIPS: toBIPS(1.05),
        rejectedRedemptionDefaultFactorPoolBIPS: toBIPS(0.05),
        transferFeeMillionths: 200,
        transferFeeClaimFirstEpochStartTs: Math.floor(new Date("2024-09-01").getTime() / 1000),
        transferFeeClaimEpochDurationSeconds: 1 * WEEKS,
        transferFeeClaimMaxUnexpiredEpochs: 12,
        coreVaultNativeAddress: "0xfa3BdC8709226Da0dA13A4d904c8b66f16c3c8BA",     // one of test accounts [9]
        coreVaultTransferFeeBIPS: toBIPS("0.5%"),
        coreVaultRedemptionFeeBIPS: toBIPS("1%"),
        coreVaultMinimumAmountLeftBIPS: 0,
        coreVaultMinimumRedeemLots: 10,
    };
}

export function createTestCollaterals(contracts: ChainContracts, chainInfo: ChainInfo, stableCoins: any): CollateralType[] {
    const poolCollateral: CollateralType = {
        collateralClass: CollateralClass.POOL,
        token: contracts.WNat!.address,
        decimals: 18,
        validUntil: 0, // not deprecated
        directPricePair: false,
        assetFtsoSymbol: chainInfo.symbol,
        tokenFtsoSymbol: "NAT",
        minCollateralRatioBIPS: toBIPS(2.2),
        ccbMinCollateralRatioBIPS: toBIPS(1.9),
        safetyMinCollateralRatioBIPS: toBIPS(2.3),
    };
    const usdcCollateral: CollateralType = {
        collateralClass: CollateralClass.VAULT,
        token: stableCoins.usdc.address,
        decimals: 6,
        validUntil: 0, // not deprecated
        directPricePair: false,
        assetFtsoSymbol: chainInfo.symbol,
        tokenFtsoSymbol: "testUSDC",
        minCollateralRatioBIPS: toBIPS(1.4),
        ccbMinCollateralRatioBIPS: toBIPS(1.3),
        safetyMinCollateralRatioBIPS: toBIPS(1.5),
    };
    const usdtCollateral: CollateralType = {
        collateralClass: CollateralClass.VAULT,
        token: stableCoins.usdt.address,
        decimals: 6,
        validUntil: 0, // not deprecated
        directPricePair: false,
        assetFtsoSymbol: chainInfo.symbol,
        tokenFtsoSymbol: "testUSDT",
        minCollateralRatioBIPS: toBIPS(1.5),
        ccbMinCollateralRatioBIPS: toBIPS(1.4),
        safetyMinCollateralRatioBIPS: toBIPS(1.6),
    };
    return [poolCollateral, usdcCollateral, usdtCollateral];
}

export async function setLotSizeAmg(newLotSizeAMG: BNish, context: TestAssetBotContext, governance: string) {
    await waitForTimelock(
        context.assetManagerController.setLotSizeAmg([context.assetManager.address], newLotSizeAMG, { from: governance }),
        context.assetManagerController,
        governance
    );
}

export function testTimekeeperTimingConfig(overrides?: Partial<TimekeeperTimingConfig>): TimekeeperTimingConfig {
    return {
        queryWindow: "auto",
        updateIntervalMs: 60_000,
        loopDelayMs: 5000,
        maxUnderlyingTimestampAgeS: 1,
        maxUpdateTimeDelayMs: 0,
        ...overrides
    };
}

export async function assignCoreVaultManager(assetManager: IIAssetManagerInstance, addressUpdater: AddressUpdaterInstance, coreVaultUnderlyingAddress: string, coreVaultCustodian?: string, initialNonce: BNish = 1, triggeringAccount?: string) {
    const coreVaultManagerImpl = await CoreVaultManager.new();
    const settings = await assetManager.getSettings();
    const governanceSettings = await assetManager.governanceSettings();
    const governance = await assetManager.governance();
    const coreVaultCustodianAddress = coreVaultCustodian ?? "TEST_CORE_VAULT_CUSTODIAN";
    const coreVaultManagerProxy = await CoreVaultManagerProxy.new(coreVaultManagerImpl.address, governanceSettings, governance, addressUpdater.address,
        assetManager.address, settings.chainId, coreVaultCustodianAddress, coreVaultUnderlyingAddress, initialNonce);
    const coreVaultManager = await CoreVaultManager.at(coreVaultManagerProxy.address);
    await addressUpdater.updateContractAddresses([coreVaultManager.address], { from: governance });
    await coreVaultManager.addTriggeringAccounts([triggeringAccount ?? governance], { from: governance });
    await coreVaultManager.updateSettings(0, 0, 0, 50, { from: governance });
    await waitForTimelock(assetManager.setCoreVaultManager(coreVaultManager.address, { from: governance }), assetManager, governance);
    return coreVaultManager;
}
