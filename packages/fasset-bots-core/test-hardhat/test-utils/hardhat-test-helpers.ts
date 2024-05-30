import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deepCopy } from "./deepCopy";
import { copyORM, isRegisteredORM } from "../../test/test-utils/create-test-orm";

/**
 * Like Hardhat's `loadFixture`, but copies the returned variables, with special handling for ORM.
 * @param fixture the the initialization function.
 *  Must not be an anonymous function, otherwise it will be called every time instead of creating a snapshot.
 * @returns The (copy of) variables returned by `fixture`.
 */
export async function loadFixtureCopyVars<T extends object>(fixture: () => Promise<T>): Promise<T> {
    const vars = await loadFixture(fixture);
    // make sure ORM is copied in a special way
    const copiedObjectMap: Map<any, any> = new Map();
    for (const value of Object.values(vars)) {
        if (isRegisteredORM(value)) {
            copiedObjectMap.set(value, await copyORM(value));
        }
    }
    // copy all vars (including ORM)
    return deepCopy(vars, copiedObjectMap);
}
