import { time } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import coder from "web3-eth-abi";
import { AbiItem } from "web3-utils";
import { AssetManagerSettings, CollateralType } from "../../src/fasset/AssetManagerTypes";
import { findEvent } from "../../src/utils/events/truffle";
import { requireNotNull } from "../../src/utils/helpers";
import { artifacts, web3 } from "../../src/utils/web3";
import { web3DeepNormalize } from "../../src/utils/web3normalize";
import { AssetManagerControllerInstance, AssetManagerInitInstance, FAssetInstance, GovernanceSettingsInstance, IDiamondLoupeInstance, IIAssetManagerInstance, Truffle } from "../../typechain-truffle";
import { GovernanceCallTimelocked } from "../../typechain-truffle/AssetManagerController";
import { DiamondCut, FacetCutAction } from "./diamond";

export interface AssetManagerInitSettings extends AssetManagerSettings {
    redemptionPaymentExtensionSeconds: string | number | BN;
}

const IIAssetManager = artifacts.require('IIAssetManager');
const AssetManager = artifacts.require('AssetManager');
const AssetManagerInit = artifacts.require('AssetManagerInit');
const GovernedFacet = artifacts.require('GovernedFacet');
const FAsset = artifacts.require('FAsset');
const FAssetProxy = artifacts.require('FAssetProxy');

export async function newAssetManager(
    governanceAddress: string,
    assetManagerController: string | AssetManagerControllerInstance,
    name: string,
    symbol: string,
    assetName: string,
    assetSymbol: string,
    decimals: number,
    assetManagerSettings: AssetManagerInitSettings,
    collateralTokens: CollateralType[],
    options?: {
        governanceSettings?: string | GovernanceSettingsInstance,
        updateExecutor?: string,
    }
): Promise<[IIAssetManagerInstance, FAssetInstance]> {
    // 0x8... is not a contract, but it is valid non-zero address so it will work in tests where we don't switch to production mode
    const governanceSettings = options?.governanceSettings ?? "0x8000000000000000000000000000000000000000";
    const updateExecutor = options?.updateExecutor ?? governanceAddress;
    const fAssetImpl = await FAsset.new();
    const fAssetProxy = await FAssetProxy.new(fAssetImpl.address, name, symbol, assetName, assetSymbol, decimals);
    const fAsset = await FAsset.at(fAssetProxy.address);
    const assetManagerControllerAddress = typeof assetManagerController === 'string' ? assetManagerController : assetManagerController.address;
    assetManagerSettings = web3DeepNormalize({
        ...assetManagerSettings,
        assetManagerController: assetManagerControllerAddress,
        fAsset: fAsset.address
    });
    collateralTokens = web3DeepNormalize(collateralTokens);
    // deploy
    const [diamondCuts, assetManagerInit, interfaceSelectors] = await deployAssetManagerFacets();
    const assetManager = await newAssetManagerDiamond(diamondCuts, assetManagerInit, governanceSettings, governanceAddress, assetManagerSettings, collateralTokens);
    await deployRedemptionTimeExtensionFacet(governanceAddress, assetManager, assetManagerSettings, interfaceSelectors);
    await checkAllMethodsImplemented(assetManager, interfaceSelectors);
    // add to controller
    if (typeof assetManagerController !== 'string') {
        const res = await assetManagerController.addAssetManager(assetManager.address, { from: governanceAddress });
        await waitForTimelock(res, assetManagerController, updateExecutor);
    } else {
        // simulate attaching to asset manager controller (for unit tests, where controller is an eoa address)
        await assetManager.attachController(true, { from: assetManagerController });
    }
    await fAsset.setAssetManager(assetManager.address, { from: governanceAddress });
    return [assetManager, fAsset];
}

export async function newAssetManagerDiamond(diamondCuts: DiamondCut[], assetManagerInit: AssetManagerInitInstance, governanceSettings: string | GovernanceSettingsInstance,
    governanceAddress: string, assetManagerSettings: AssetManagerSettings, collateralTokens: CollateralType[]) {
    const governanceSettingsAddress = typeof governanceSettings === 'string' ? governanceSettings : governanceSettings.address;
    const initParameters = abiEncodeCall(assetManagerInit, "init",
        [governanceSettingsAddress, governanceAddress, assetManagerSettings, collateralTokens]);
    const assetManagerDiamond = await AssetManager.new(diamondCuts, assetManagerInit.address, initParameters);
    return await IIAssetManager.at(assetManagerDiamond.address);
}

async function deployRedemptionTimeExtensionFacet(governanceAddress: string, assetManager: IIAssetManagerInstance, assetManagerSettings: AssetManagerInitSettings, interfaceSelectors: Map<string, AbiItem>) {
    const governedFacet = await GovernedFacet.at(assetManager.address);
    const governedFacetSelectors = getInterfaceSelectorMap(governedFacet.abi);
    const diamondCuts = [
        await deployFacet('RedemptionTimeExtensionFacet', interfaceSelectors, governedFacetSelectors),
    ];
    const RedemptionTimeExtensionFacet = artifacts.require("RedemptionTimeExtensionFacet");
    const redemptionTimeExtensionFacet = await RedemptionTimeExtensionFacet.at(diamondCuts[0].facetAddress);
    const initParameters = abiEncodeCall(redemptionTimeExtensionFacet, "initRedemptionTimeExtensionFacet",
        [assetManagerSettings.redemptionPaymentExtensionSeconds]);
    await assetManager.diamondCut(diamondCuts, redemptionTimeExtensionFacet.address, initParameters, { from: governanceAddress });
}

// simulate waiting for governance timelock
export async function waitForTimelock<C extends Truffle.ContractInstance>(response: Truffle.TransactionResponse<any> | Promise<Truffle.TransactionResponse<any>>, contract: C, executorAddress: string) {
    const res = await response as Truffle.TransactionResponse<GovernanceCallTimelocked>;
    const timelockEvent = findEvent(res, 'GovernanceCallTimelocked');
    if (timelockEvent) {
        const timelock = timelockEvent.args;
        await time.increaseTo(Number(timelock.allowedAfterTimestamp) + 1);
        return await (contract as any).executeGovernanceCall(timelock.encodedCall, { from: executorAddress });
    }
}

export interface IMembership<T> { has(x: T): boolean }

export async function deployAssetManagerFacets(): Promise<[DiamondCut[], AssetManagerInitInstance, Map<string, AbiItem>]> {
    const assetManagerInit = await AssetManagerInit.new();
    // create filters
    const iiAssetManager = await IIAssetManager.at(assetManagerInit.address);
    const interfaceSelectors = getInterfaceSelectorMap(iiAssetManager.abi);
    // create cuts
    const diamondCuts = [
        await deployFacet('AssetManagerDiamondCutFacet', interfaceSelectors),
        await deployFacet('DiamondLoupeFacet', interfaceSelectors),
        await deployFacet('AgentInfoFacet', interfaceSelectors),
        await deployFacet('AvailableAgentsFacet', interfaceSelectors),
        await deployFacet('MintingFacet', interfaceSelectors),
        await deployFacet('RedemptionRequestsFacet', interfaceSelectors),
        await deployFacet('RedemptionConfirmationsFacet', interfaceSelectors),
        await deployFacet('RedemptionDefaultsFacet', interfaceSelectors),
        await deployFacet('LiquidationFacet', interfaceSelectors),
        await deployFacet('ChallengesFacet', interfaceSelectors),
        await deployFacet('UnderlyingBalanceFacet', interfaceSelectors),
        await deployFacet('UnderlyingTimekeepingFacet', interfaceSelectors),
        await deployFacet('AgentVaultManagementFacet', interfaceSelectors),
        await deployFacet('AgentSettingsFacet', interfaceSelectors),
        await deployFacet('CollateralTypesFacet', interfaceSelectors),
        await deployFacet('AgentCollateralFacet', interfaceSelectors),
        await deployFacet('SettingsReaderFacet', interfaceSelectors),
        await deployFacet('SettingsManagementFacet', interfaceSelectors),
        await deployFacet('AgentVaultAndPoolSupportFacet', interfaceSelectors),
        await deployFacet('SystemStateManagementFacet', interfaceSelectors),
        await deployFacet('EmergencyPauseFacet', interfaceSelectors),
        await deployFacet('AgentPingFacet', interfaceSelectors),
    ];
    // verify every required selector is included in some cut
    return [diamondCuts, assetManagerInit, interfaceSelectors];
}

async function checkAllMethodsImplemented(loupe: IDiamondLoupeInstance, interfaceSelectors: Map<string, AbiItem>) {
    const interfaceSelectorSet = new Set(interfaceSelectors.keys());
    const facets = await loupe.facets();
    for (const facet of facets) {
        for (const selector of facet.functionSelectors) {
            interfaceSelectorSet.delete(selector);
        }
    }
    if (interfaceSelectorSet.size > 0) {
        const missing = Array.from(interfaceSelectorSet).map(sel => interfaceSelectors.get(sel)?.name);
        throw new Error(`Deployed facets are missing methods ${missing.join(", ")}`);
    }
}

function getInterfaceSelectorMap(abiItems: AbiItem[]) {
    const interfaceSelectorPairs = abiItems
        .filter(it => it.type === 'function')
        .map(it => [web3.eth.abi.encodeFunctionSignature(it), it] as const);
    return new Map(interfaceSelectorPairs);
}

export async function deployFacet(facetName: string, filterSelectors: IMembership<string>, excludeSelectors: IMembership<string> = new Set()): Promise<DiamondCut> {
    const contract = artifacts.require(facetName as any) as Truffle.ContractNew<any>;
    const instance = await contract.new() as Truffle.ContractInstance;
    const instanceSelectors = instance.abi.map(it => web3.eth.abi.encodeFunctionSignature(it));
    const exposedSelectors = instanceSelectors.filter(sel => filterSelectors.has(sel) && !excludeSelectors.has(sel));
    if (exposedSelectors.length === 0) {
        throw new Error(`No exposed methods in ${facetName}`);
    }
    return {
        action: FacetCutAction.Add,
        facetAddress: instance.address,
        functionSelectors: [...exposedSelectors]
    };
}

export function abiEncodeCall<I extends Truffle.ContractInstance>(instance: I, method: string, args: any[]): string {
    const abiItem = requireNotNull(instance.abi.find(it => it.name === method && it.type === 'function'));
    return coder.encodeFunctionCall(abiItem, args);
}
