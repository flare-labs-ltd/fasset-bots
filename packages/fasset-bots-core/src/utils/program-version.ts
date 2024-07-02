import fs from "fs";
import path from "path";
import { resolveFromPackageRoot } from "./package-paths";

let _programVersion: string | undefined;

export function programVersion() {
    if (_programVersion == undefined) {
        const mainFileDir = require.main?.filename ? path.dirname(require.main?.filename) : __dirname;
        const packageFile = resolveFromPackageRoot(mainFileDir, "package.json");
        const packageJson = JSON.parse(fs.readFileSync(packageFile).toString()) as { version?: string };
        _programVersion = packageJson.version ?? "---";
    }
    return _programVersion;
}
