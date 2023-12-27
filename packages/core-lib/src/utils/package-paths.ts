import fs from "fs";
import path from "path";

/**
 * Root path of `fasset-bots-core` project.
 */
export const FASSET_BOTS_CORE_ROOT = findPackageRoot(__dirname);

/**
 * Find the package root than contains the directory.
 * @param moduleDir the directory of a module, typically use `__dirname`
 * @returns the directory of the modules's package root.
 */
export function findPackageRoot(moduleDir: string) {
    let dir = path.resolve(moduleDir);
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const packageJson = path.resolve(dir, "package.json");
        if (fs.existsSync(packageJson) && fs.statSync(packageJson).isFile()) {
            return dir;
        }
        /* istanbul ignore next */
        if (path.dirname(dir) === dir) {
            // arrived at filesystem root without finding package root
            throw new Error("Cannot find package root");
        }
        dir = path.dirname(dir);
    }
}

/**
 * Find the package root than contains the directory and then resolve `relativePath` relative to the found root.
 * Does not require that the `relativePath` exists in package root.
 * @param moduleDir the directory of a module, typically use `__dirname`
 * @param relativePath the path to be resolved relative to the root
 * @returns the resolved path as absolute path
 */
export function resolveFromPackageRoot(moduleDir: string, relativePath: string) {
    return path.resolve(findPackageRoot(moduleDir), relativePath);
}

/**
 * Resolve `relativePath` relative to the fasset-bots-core package's root dir.
 * Does not require that the `relativePath` exists in the package root.
 * @param relativePath the path to be resolved relative to the root
 * @returns the resolved path as absolute path
 */
export function resolveInFassetBotsCore(relativePath: string) {
    return path.resolve(FASSET_BOTS_CORE_ROOT, relativePath);
}
