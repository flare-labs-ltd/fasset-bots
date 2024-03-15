import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deepCopy } from "./deepCopy";

/**
 * Like Hardhat's `loadFixture`, but copies the returned variables.
 * @param fixture the the initialization function.
 *  Must not be an anonimous function, otherwise it will be called every time instead of creating a snapshot.
 * @returns The (copy of) variables returned by `fixture`.
 */
export function loadFixtureCopyVars<T>(fixture: () => Promise<T>): Promise<T> {
    return loadFixture(fixture).then(deepCopy);
}
