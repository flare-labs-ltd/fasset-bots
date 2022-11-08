import { time } from "@openzeppelin/test-helpers";
import { AssetManagerSettings } from "../../src/fasset/AssetManagerTypes";
import { artifacts } from "../../src/utils/artifacts";
import { findEvent } from "../../src/utils/events/truffle";
import { AssetManagerControllerInstance, AssetManagerInstance, FAssetInstance } from "../../typechain-truffle";
import { GovernanceCallTimelocked } from "../../typechain-truffle/AssetManagerController";

export async function newAssetManager(
    governanceAddress: string,
    assetManagerController: string | AssetManagerControllerInstance,
    name: string, 
    symbol: string, 
    decimals: number,
    assetManagerSettings: AssetManagerSettings,
    updateExecutor: string = governanceAddress
): Promise<[AssetManagerInstance, FAssetInstance]> {
    const AssetManager = await linkAssetManager();
    const FAsset = artifacts.require('FAsset');
    const fAsset = await FAsset.new(governanceAddress, name, symbol, decimals);
    const assetManagerControllerAddress = typeof assetManagerController === 'string' ? assetManagerController : assetManagerController.address;
    assetManagerSettings = { ...assetManagerSettings, assetManagerController: assetManagerControllerAddress };
    const assetManager = await AssetManager.new(assetManagerSettings, fAsset.address);
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

// simulate waiting for governance timelock
export async function waitForTimelock<C extends Truffle.ContractInstance>(response: Truffle.TransactionResponse<any> | Promise<Truffle.TransactionResponse<any>>, contract: C, executorAddress: string) {
    const res = await response as Truffle.TransactionResponse<GovernanceCallTimelocked>;
    const timelockEvent = findEvent(res, 'GovernanceCallTimelocked');
    if (timelockEvent) {
        const timelock = timelockEvent.args;
        await time.increaseTo(Number(timelock.allowedAfterTimestamp) + 1);
        await (contract as any).executeGovernanceCall(timelock.selector, { from: executorAddress });
    }
}

export async function linkAssetManager() {
    // deploy all libraries
    const SettingsUpdater = await deployLibrary('SettingsUpdater');
    const StateUpdater = await deployLibrary('StateUpdater');
    const Agents = await deployLibrary('Agents');
    const AvailableAgents = await deployLibrary('AvailableAgents');
    const CollateralReservations = await deployLibrary('CollateralReservations');
    const Liquidation = await deployLibrary('Liquidation');
    const Minting = await deployLibrary('Minting');
    const UnderlyingFreeBalance = await deployLibrary('UnderlyingFreeBalance');
    const Redemption = await deployLibrary('Redemption');
    const UnderlyingWithdrawalAnnouncements = await deployLibrary('UnderlyingWithdrawalAnnouncements');
    const Challenges = await deployLibrary('Challenges');
    const FullAgentInfo = await deployLibrary('FullAgentInfo');
    // link AssetManagerContract
    return linkDependencies(artifacts.require('AssetManager'), { 
        SettingsUpdater, StateUpdater, Agents, AvailableAgents, CollateralReservations, Liquidation, Minting, 
        UnderlyingFreeBalance, Redemption, UnderlyingWithdrawalAnnouncements, Challenges, FullAgentInfo
    });
}

export function deployLibrary(name: string, dependencies: { [key: string]: Truffle.ContractInstance } = {}): Promise<Truffle.ContractInstance> {
    // libraries don't have typechain info generated, so we have to import as 'any' (but it's no problem, since we only use them for linking)
    return linkDependencies(artifacts.require(name as any), dependencies).new();
}

export function linkDependencies<T extends Truffle.Contract<any>>(contract: T, dependencies: { [key: string]: Truffle.ContractInstance } = {}): T {
    // from hardhat-truffle5/src/artifacts.ts method link()
    const contractAny = contract as any;
    const contractJson = contractAny._originalJson;
    const linkReferences: Record<string, Record<string, Array<{start: number, length: number}>>> = contractJson.linkReferences;
    const bytecode: string = contractJson.bytecode;
    for (const libfile of Object.values(linkReferences)) {
        for (const [libName, occList] of Object.entries(libfile)) {
            const {start, length} = occList[0];
            const refName = bytecode.slice(2 + 2 * start, 2 + 2 * (start + length)).replace(/_/g, '').replace(/\$/g, '\\$');
            const library = dependencies[libName];
            if (library == null) {
                console.warn(`Missing library ${libName} while linking ${contract.contractName}`);
                continue;
            }
            if (contractAny.network_id == null) {
                contractAny.setNetwork((library.constructor as any).network_id);
            }
            contract.link(refName, library.address);
        }
    }
    return contract;
}
