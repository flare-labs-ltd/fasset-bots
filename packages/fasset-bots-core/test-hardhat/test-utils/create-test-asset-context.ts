import { time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import fs from "fs";
import { ChainId, TimekeeperTimingConfig } from "../../src";
import { Secrets } from "../../src/config";
import { ChainAccount, SecretsFile } from "../../src/config/config-files/SecretsFile";
import { ChainContracts, newContract } from "../../src/config/contracts";
import { IAssetAgentContext, IAssetNativeChainContext, IERC20Events } from "../../src/fasset-bots/IAssetBotContext";
import { AssetManagerSettings, CollateralClass, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { ChainInfo } from "../../src/fasset/ChainInfo";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { MockIndexer } from "../../src/mock/MockIndexer";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { MockVerificationApiClient } from "../../src/mock/MockVerificationApiClient";
import { AttestationHelper } from "../../src/underlying-chain/AttestationHelper";
import { ContractWithEvents } from "../../src/utils/events/truffle";
import { BNish, DAYS, HOURS, MAX_BIPS, MINUTES, Modify, ZERO_ADDRESS, toBIPS, toBNExp } from "../../src/utils/helpers";
import { artifacts } from "../../src/utils/web3";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { TestChainInfo, testNativeChainInfo } from "../../test/test-utils/TestChainInfo";
import { AssetManagerControllerInstance, FakeERC20Instance } from "../../typechain-truffle";
import { FtsoManagerMockInstance } from "../../typechain-truffle/FtsoManagerMock";
import { FtsoMockInstance } from "../../typechain-truffle/FtsoMock";
import { FtsoRegistryMockInstance } from "../../typechain-truffle/FtsoRegistryMock";
import { FaultyWallet } from "./FaultyWallet";
import { newAssetManager, waitForTimelock } from "./new-asset-manager";

const AgentVaultFactory = artifacts.require("AgentVaultFactory");
const SCProofVerifier = artifacts.require("SCProofVerifier");
const AssetManagerController = artifacts.require("AssetManagerController");
const AddressUpdater = artifacts.require("AddressUpdater");
const WNat = artifacts.require("WNat");
const FtsoMock = artifacts.require("FtsoMock");
const FtsoRegistryMock = artifacts.require("FtsoRegistryMock");
const FtsoManagerMock = artifacts.require("FtsoManagerMock");
const StateConnector = artifacts.require("StateConnectorMock");
const GovernanceSettings = artifacts.require("GovernanceSettings");
const VPContract = artifacts.require("VPContract");
const CollateralPoolFactory = artifacts.require("CollateralPoolFactory");
const CollateralPoolTokenFactory = artifacts.require("CollateralPoolTokenFactory");
const FakeERC20 = artifacts.require("FakeERC20");
const AgentOwnerRegistry = artifacts.require("AgentOwnerRegistry");
const PriceReader = artifacts.require("FtsoV1PriceReader");

export type AssetManagerControllerEvents = import("../../typechain-truffle/AssetManagerController").AllEvents;

const GENESIS_GOVERNANCE = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";

export type TestFtsos = Record<"nat" | "usdc" | "usdt" | "eth" | "asset", FtsoMockInstance>;

export const ftsoNatInitialPrice = 0.42;
export const ftsoUsdcInitialPrice = 1.01;
export const ftsoUsdtInitialPrice = 0.99;
export const ftsoEthInitialPrice = 2000;

export type TestAssetBotContext = Modify<
    IAssetAgentContext,
    {
        natFtso: FtsoMockInstance;
        assetFtso: FtsoMockInstance;
        ftsoManager: FtsoManagerMockInstance;
        ftsos: TestFtsos;
        blockchainIndexer: MockIndexer;
        assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
        stablecoins: Record<string, ContractWithEvents<FakeERC20Instance, IERC20Events>>;
        collaterals: CollateralType[];
    }
>;

export type TestAssetTrackedStateContext = Modify<
    IAssetNativeChainContext,
    {
        attestationProvider: AttestationHelper;
        assetFtso: FtsoMockInstance;
        ftsoManager: FtsoManagerMockInstance;
        blockchainIndexer: MockIndexer;
        stablecoins: Record<string, ContractWithEvents<FakeERC20Instance, IERC20Events>>;
        collaterals: CollateralType[];
        liquidationStrategy?: { className: string; config?: any; };
        challengeStrategy?: { className: string; config?: any; };
    }
>;

export async function createTestChainContracts(governance: string, updateExecutor?: string) {
    // create governance settings
    const governanceSettings = await GovernanceSettings.new();
    await governanceSettings.initialise(governance, 60, [governance], { from: GENESIS_GOVERNANCE });
    // add update executors
    if (updateExecutor) {
        await governanceSettings.setExecutors([governance, updateExecutor], { from: governance });
    }
    // create state connector
    const stateConnector = await StateConnector.new();
    // create agent vault factory
    const agentVaultFactory = await AgentVaultFactory.new();
    // create attestation client
    const scProofVerifier = await SCProofVerifier.new(stateConnector.address);
    // create asset manager controller
    const addressUpdater = await AddressUpdater.new(governance); // don't switch to production
    const assetManagerController = await AssetManagerController.new(governanceSettings.address, governance, addressUpdater.address);
    await assetManagerController.switchToProductionMode({ from: governance });
    // create WNat token
    const wNat = await WNat.new(governance, "Wrapped Native", "WNAT");
    const vpContract = await VPContract.new(wNat.address, false);
    await wNat.setWriteVpContract(vpContract.address, { from: governance });
    await wNat.setReadVpContract(vpContract.address, { from: governance });
    // create stablecoins
    const testUSDC = await FakeERC20.new(governance, "Test USDCoin", "testUSDC", 6);
    const testUSDT = await FakeERC20.new(governance, "Test Tether", "testUSDT", 6);
    const testETH = await FakeERC20.new(governance, "Test Ethereum", "testETH", 18);
    // create ftso registry
    const ftsoRegistry = await FtsoRegistryMock.new();
    // await ftsoRegistry.addFtso(natFtso.address);
    const ftsoManager = await FtsoManagerMock.new();
    // ftsos
    await createFtsoMock(ftsoRegistry, "NAT", ftsoNatInitialPrice);
    await createFtsoMock(ftsoRegistry, "testUSDC", ftsoUsdcInitialPrice);
    await createFtsoMock(ftsoRegistry, "testUSDT", ftsoUsdtInitialPrice);
    await createFtsoMock(ftsoRegistry, "testETH", ftsoEthInitialPrice);
    // create price reader
    const priceReader = await PriceReader.new(addressUpdater.address, ftsoRegistry.address);
    // create collateral pool factory
    const collateralPoolFactory = await CollateralPoolFactory.new();
    const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new();
    // create allow-all agent owner registry
    const agentOwnerRegistry = await AgentOwnerRegistry.new(governanceSettings.address, governance, true);
    await agentOwnerRegistry.setAllowAll(true, { from: governance });
    // set contracts
    const contracts: ChainContracts = {
        GovernanceSettings: newContract("GovernanceSettings", "GovernanceSettings.sol", governanceSettings.address),
        AddressUpdater: newContract("AddressUpdater", "AddressUpdater.sol", addressUpdater.address),
        StateConnector: newContract("StateConnector", "StateConnectorMock.sol", stateConnector.address),
        WNat: newContract("WNat", "WNat.sol", wNat.address),
        FtsoRegistry: newContract("FtsoRegistry", "FtsoRegistryMock.sol", ftsoRegistry.address),
        FtsoManager: newContract("FtsoManager", "FtsoManagerMock.sol", ftsoManager.address),
        SCProofVerifier: newContract("SCProofVerifier", "SCProofVerifier.sol", scProofVerifier.address),
        AgentVaultFactory: newContract("AgentVaultFactory", "AgentVaultFactory.sol", agentVaultFactory.address),
        AssetManagerController: newContract("AssetManagerController", "AssetManagerController.sol", assetManagerController.address),
        CollateralPoolFactory: newContract("CollateralPoolFactory", "CollateralPoolFactory.sol", collateralPoolFactory.address),
        AgentOwnerRegistry: newContract("AgentOwnerRegistry", "AgentOwnerRegistry.sol", agentOwnerRegistry.address),
        CollateralPoolTokenFactory: newContract("CollateralPoolTokenFactory", "CollateralPoolTokenFactory.sol", collateralPoolTokenFactory.address),
        PriceReader: newContract("PriceReader", "PriceReader.sol", priceReader.address),
        TestUSDC: newContract("TestUSDC", "FakeERC20.sol", testUSDC.address),
        TestUSDT: newContract("TestUSDT", "FakeERC20.sol", testUSDT.address),
        TestETH: newContract("TestETH", "FakeERC20.sol", testETH.address),
    };
    return contracts;
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
    stateConnectorClient?: MockStateConnectorClient;
};

export async function createTestAssetContext(
    governance: string,
    chainInfo: TestChainInfo,
    options: CreateTestAssetContextOptions = {}
): Promise<TestAssetBotContext> {
    const contracts = options.contracts ?? await createTestChainContracts(governance, options.updateExecutor);
    // contract wrappers
    const stateConnector = await StateConnector.at(contracts.StateConnector.address);
    const assetManagerController = await AssetManagerController.at(contracts.AssetManagerController.address);
    const ftsoRegistry = await FtsoRegistryMock.at(contracts.FtsoRegistry.address);
    const ftsoManager = await FtsoManagerMock.at(contracts.FtsoManager.address);
    const wNat = await WNat.at(contracts.WNat.address);
    const addressUpdater = await AddressUpdater.at(contracts.AddressUpdater.address);
    const agentOwnerRegistry = await AgentOwnerRegistry.at(contracts.AgentOwnerRegistry.address);
    // stablecoins
    const stablecoins = {
        usdc: await FakeERC20.at(contracts.TestUSDC!.address),
        usdt: await FakeERC20.at(contracts.TestUSDT!.address),
        eth: await FakeERC20.at(contracts.TestETH!.address),
    };
    // ftsos
    const ftsos: TestFtsos = {
        nat: await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol("NAT")),
        usdc: await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol("testUSDC")),
        usdt: await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol("testUSDT")),
        eth: await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol("testETH")),
        asset: await createFtsoMock(ftsoRegistry, chainInfo.symbol, chainInfo.startPrice),
    }
    // create mock chain attestation provider
    const chain = options.chain ?? await createTestChain(chainInfo);
    const stateConnectorClient = options.stateConnectorClient ?? new MockStateConnectorClient(stateConnector, {}, "auto", options.useAlwaysFailsProver ?? false);
    stateConnectorClient.addChain(chainInfo.chainId, chain);
    const verificationClient = new MockVerificationApiClient();
    const attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainInfo.chainId);
    const wallet = options.useFaultyWallet ? new FaultyWallet() : new MockChainWallet(chain);
    // collaterals
    const collaterals = createTestCollaterals(contracts, chainInfo, stablecoins);
    // create asset manager
    const parameterFilename = chainInfo.parameterFile ?? `./fasset-config/hardhat/f-${chainInfo.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    const settings = createTestAssetManagerSettings(contracts, options.customParameters ?? parameters, chainInfo, options.requireEOAAddressProof);
    // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
    const [assetManager, fAsset] = await newAssetManager(governance, options.assetManagerControllerAddress ?? assetManagerController,
        `F${chainInfo.name}`, `F${chainInfo.symbol}`, chainInfo.name, chainInfo.symbol, chainInfo.decimals, web3DeepNormalize(settings), collaterals);
    // indexer
    const blockchainIndexer = new MockIndexer("", chainInfo.chainId, chain);
    // return context
    return {
        nativeChainInfo: testNativeChainInfo,
        chainInfo,
        blockchainIndexer,
        wallet,
        attestationProvider,
        assetManager,
        assetManagerController,
        ftsoManager,
        wNat,
        fAsset,
        natFtso: ftsos.nat,
        assetFtso: ftsos.asset,
        ftsos,
        addressUpdater,
        priceChangeEmitter: ftsoManager,
        collaterals,
        stablecoins,
        verificationClient,
        agentOwnerRegistry,
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
        nativeChainInfo: context.nativeChainInfo,
        blockchainIndexer: context.blockchainIndexer,
        attestationProvider: context.attestationProvider,
        assetManager: context.assetManager,
        assetManagerController: context.assetManagerController,
        ftsoManager: context.ftsoManager,
        fAsset: context.fAsset,
        wNat: context.wNat,
        addressUpdater: context.addressUpdater,
        assetFtso: context.assetFtso,
        priceChangeEmitter: context.priceChangeEmitter,
        collaterals: context.collaterals,
        stablecoins: context.stablecoins,
        agentOwnerRegistry: context.agentOwnerRegistry,
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
): AssetManagerSettings {
    if (!contracts.AssetManagerController || !contracts.AgentVaultFactory || !contracts.SCProofVerifier) {
        throw new Error("Missing contracts");
    }
    return {
        assetManagerController: contracts.AssetManagerController.address,
        fAsset: ZERO_ADDRESS, // replaced in newAssetManager()
        agentVaultFactory: contracts.AgentVaultFactory.address,
        collateralPoolFactory: contracts.CollateralPoolFactory.address,
        collateralPoolTokenFactory: contracts.CollateralPoolTokenFactory.address,
        scProofVerifier: contracts.SCProofVerifier.address,
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
        //TODO
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

export async function createFtsoMock(
    ftsoRegistry: FtsoRegistryMockInstance,
    ftsoSymbol: string,
    initialPrice: number,
    decimals: number = 5
): Promise<FtsoMockInstance> {
    const ftso = await FtsoMock.new(ftsoSymbol, decimals);
    await ftso.setCurrentPrice(toBNExp(initialPrice, decimals), 0);
    await ftso.setCurrentPriceFromTrustedProviders(toBNExp(initialPrice, decimals), 0);
    await ftsoRegistry.addFtso(ftso.address);
    return ftso;
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
