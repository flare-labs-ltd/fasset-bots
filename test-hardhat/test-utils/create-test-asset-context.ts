import { time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import fs from "fs";
import { ChainContracts, newContract } from "../../src/config/contracts";
import { IAssetAgentBotContext, IAssetActorContext } from "../../src/fasset-bots/IAssetBotContext";
import { AssetManagerSettings, CollateralType, CollateralClass } from "../../src/fasset/AssetManagerTypes";
import { ChainInfo } from "../../src/fasset/ChainInfo";
import { encodeLiquidationStrategyImplSettings, LiquidationStrategyImplSettings } from "../../src/fasset/LiquidationStrategyImpl";
import { MockChain, MockChainWallet } from "../../src/mock/MockChain";
import { MockIndexer } from "../../src/mock/MockIndexer";
import { MockStateConnectorClient } from "../../src/mock/MockStateConnectorClient";
import { AttestationHelper } from "../../src/underlying-chain/AttestationHelper";
import { BNish, DAYS, HOURS, MAX_BIPS, MINUTES, Modify, toBIPS, toBNExp, ZERO_ADDRESS } from "../../src/utils/helpers";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { TestChainInfo, testNativeChainInfo } from "../../test/test-utils/TestChainInfo";
import { newAssetManager, waitForTimelock } from "./new-asset-manager";
import { FtsoMockInstance } from "../../typechain-truffle/FtsoMock";
import { FtsoManagerMockInstance } from "../../typechain-truffle/FtsoManagerMock";
import { FtsoRegistryMockInstance } from "../../typechain-truffle/FtsoRegistryMock";
import { ContractWithEvents } from "../../src/utils/events/truffle";
import { AssetManagerControllerInstance } from "../../typechain-truffle";
import { artifacts } from "../../src/utils/web3";

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
const ERC20Mock = artifacts.require("ERC20Mock");
const TrivialAddressValidatorMock = artifacts.require("TrivialAddressValidatorMock");
const WhitelistMock = artifacts.require("WhitelistMock");
const PriceReader = artifacts.require("FtsoV1PriceReader");

export type AssetManagerControllerEvents = import("../../typechain-truffle/AssetManagerController").AllEvents;

const GENESIS_GOVERNANCE = "0xfffEc6C83c8BF5c3F4AE0cCF8c45CE20E4560BD7";

export type TestFtsos = Record<"nat" | "usdc" | "usdt" | "asset", FtsoMockInstance>;

export const ftsoNatInitialPrice = 0.42;
export const ftsoUsdcInitialPrice = 1.01;
export const ftsoUsdtInitialPrice = 0.99;

export type TestAssetBotContext = Modify<
    IAssetAgentBotContext,
    {
        natFtso: FtsoMockInstance;
        assetFtso: FtsoMockInstance;
        ftsoManager: FtsoManagerMockInstance;
        ftsos: TestFtsos;
        blockchainIndexer: MockIndexer;
        assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>;
    }
>;

export type TestAssetTrackedStateContext = Modify<
    IAssetActorContext,
    {
        assetFtso: FtsoMockInstance;
        ftsoManager: FtsoManagerMockInstance;
        blockchainIndexer: MockIndexer;
    }
>;

export async function createTestAssetContext(
    governance: string,
    chainInfo: TestChainInfo,
    requireEOAAddressProof?: boolean,
    customParameters?: any,
    updateExecutor?: string,
    useAlwaysFailsProver?: boolean,
    assetManagerControllerAddress?: string
): Promise<TestAssetBotContext> {
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
    // create ftso registry
    const ftsoRegistry = await FtsoRegistryMock.new();
    // await ftsoRegistry.addFtso(natFtso.address);
    const ftsoManager = await FtsoManagerMock.new();
    // create price reader
    const priceReader = await PriceReader.new(addressUpdater.address, ftsoRegistry.address);
    // create collateral pool factory
    const collateralPoolFactory = await CollateralPoolFactory.new();
    const collateralPoolTokenFactory = await CollateralPoolTokenFactory.new();
    // create address validator
    const addressValidator = await TrivialAddressValidatorMock.new();
    // create liquidation strategy
    const liquidationStrategyLib = await artifacts.require("LiquidationStrategyImpl").new();
    const liquidationStrategy = liquidationStrategyLib.address;
    // create allow-all agent whitelist
    const agentWhitelist = await WhitelistMock.new(true);
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
        AddressValidator: newContract("IAddressValidatorInstance", "IAddressValidatorInstance.sol", addressValidator.address),
        AgentWhiteList: newContract("WhiteList", "WhitelistMock.sol", agentWhitelist.address),
        CollateralPoolTokenFactory: newContract("CollateralPoolTokenFactory", "CollateralPoolTokenFactory.sol", collateralPoolTokenFactory.address),
        PriceReader: newContract("PriceReader", "PriceReader.sol", priceReader.address),
    };
    // create mock chain attestation provider
    const chain = new MockChain(await time.latest());
    chain.finalizationBlocks = chainInfo.finalizationBlocks;
    chain.secondsPerBlock = chainInfo.blockTime;
    const stateConnectorClient = new MockStateConnectorClient(
        stateConnector,
        { [chainInfo.chainId]: chain },
        "auto",
        useAlwaysFailsProver ? useAlwaysFailsProver : false
    );
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
    const collaterals = createTestCollaterals(contracts, chainInfo, stablecoins);
    // create asset manager
    const parameterFilename = `./fasset-config/hardhat/f-${chainInfo.symbol.toLowerCase()}.json`;
    const parameters = JSON.parse(fs.readFileSync(parameterFilename).toString());
    const settings = createTestAssetManagerSettings(
        contracts,
        customParameters ? customParameters : parameters,
        liquidationStrategy,
        chainInfo,
        requireEOAAddressProof
    );
    // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
    const [assetManager, fAsset] = await newAssetManager(
        governance,
        assetManagerControllerAddress ?  assetManagerControllerAddress :assetManagerController,
        chainInfo.name,
        chainInfo.symbol,
        chainInfo.decimals,
        web3DeepNormalize(settings),
        collaterals,
        createEncodedTestLiquidationSettings()
    );
    // indexer
    const blockchainIndexer = new MockIndexer("", chainInfo.chainId, chain);
    //
    const natFtsoSymbol: string = collaterals[0].tokenFtsoSymbol;
    const natFtso = await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol(natFtsoSymbol));
    const assetFtso = await FtsoMock.at(await ftsoRegistry.getFtsoBySymbol(chainInfo.symbol));
    // native chain info
    const nativeChainInfo = testNativeChainInfo;
    // return context
    return {
        nativeChainInfo,
        chainInfo,
        blockchainIndexer,
        wallet,
        attestationProvider,
        assetManager,
        assetManagerController,
        ftsoManager,
        wNat,
        fAsset,
        natFtso,
        assetFtso,
        stablecoins,
        collaterals,
        ftsos,
        addressUpdater,
        priceChangeEmitter: ftsoManager,
    };
}

export function getTestAssetTrackedStateContext(context: TestAssetBotContext): TestAssetTrackedStateContext {
    return {
        nativeChainInfo: context.nativeChainInfo,
        blockchainIndexer: context.blockchainIndexer,
        attestationProvider: context.attestationProvider,
        assetManager: context.assetManager,
        ftsoManager: context.ftsoManager,
        fAsset: context.fAsset,
        assetFtso: context.assetFtso,
        collaterals: context.collaterals,
        priceChangeEmitter: context.priceChangeEmitter,
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
    liquidationStrategy: string,
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
        agentWhitelist: contracts.AgentWhiteList?.address ?? ZERO_ADDRESS,
        underlyingAddressValidator: contracts.AddressValidator!.address,
        liquidationStrategy: liquidationStrategy,
        burnAddress: parameters.burnAddress,
        chainId: chainInfo.chainId,
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
        decimals: 18,
        validUntil: 0, // not deprecated
        directPricePair: false,
        assetFtsoSymbol: chainInfo.symbol,
        tokenFtsoSymbol: "USDC",
        minCollateralRatioBIPS: toBIPS(1.4),
        ccbMinCollateralRatioBIPS: toBIPS(1.3),
        safetyMinCollateralRatioBIPS: toBIPS(1.5),
    };
    const usdtCollateral: CollateralType = {
        collateralClass: CollateralClass.VAULT,
        token: stableCoins.usdt.address,
        decimals: 18,
        validUntil: 0, // not deprecated
        directPricePair: false,
        assetFtsoSymbol: chainInfo.symbol,
        tokenFtsoSymbol: "USDT",
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

export async function createTestFtsos(ftsoRegistry: FtsoRegistryMockInstance, assetChainInfo: TestChainInfo): Promise<TestFtsos> {
    return {
        nat: await createFtsoMock(ftsoRegistry, "NAT", ftsoNatInitialPrice),
        usdc: await createFtsoMock(ftsoRegistry, "USDC", ftsoUsdcInitialPrice),
        usdt: await createFtsoMock(ftsoRegistry, "USDT", ftsoUsdtInitialPrice),
        asset: await createFtsoMock(ftsoRegistry, assetChainInfo.symbol, assetChainInfo.startPrice),
    };
}

export function createTestLiquidationSettings(): LiquidationStrategyImplSettings {
    return {
        liquidationStepSeconds: 90,
        liquidationCollateralFactorBIPS: [toBIPS(1.2), toBIPS(1.6), toBIPS(2.0)],
        liquidationFactorVaultCollateralBIPS: [toBIPS(1), toBIPS(1), toBIPS(1)],
    };
}

export function createEncodedTestLiquidationSettings() {
    return encodeLiquidationStrategyImplSettings(createTestLiquidationSettings());
}

export async function setLotSizeAmg(newLotSizeAMG: BNish, context: TestAssetBotContext, governance: string) {
    await waitForTimelock(
        context.assetManagerController.setLotSizeAmg([context.assetManager.address], newLotSizeAMG, { from: governance }),
        context.assetManagerController,
        governance
    );
}
