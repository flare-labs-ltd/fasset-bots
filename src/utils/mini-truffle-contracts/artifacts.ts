import fs from "fs";
import { globSync } from "glob";
import path from "path";
import { MiniTruffleContract } from "./contracts";
import { ContractJson, ContractSettings } from "./types";

interface ArtifactData {
    name: string;
    path: string;
    contractJson?: string;
}

export function createArtifacts(rootPath: string, settings: ContractSettings) {
    return new ArtifactsImpl(rootPath, settings);
}

class ArtifactsImpl implements Truffle.Artifacts {
    private artifactMap?: Map<string, ArtifactData>;

    constructor(
        private rootPath: string,
        private settings: ContractSettings
    ) {}

    /**
     * Reads path of all artifacts in artifact root path and creates a map for fast searching in artifacts.require.
     * @returns the generated map
     */
    loadArtifactMap() {
        const artifactMap = new Map<string, ArtifactData>();
        const paths = globSync(path.join(this.rootPath, "**/*.json").replace(/\\/g, "/"));
        for (const fpath of paths) {
            const name = path.basename(fpath, path.extname(fpath));
            const solPath = path.relative(this.rootPath, path.dirname(fpath)).replace(/\\/g, "/");
            const data: ArtifactData = { name: name, path: fpath };
            artifactMap.set(name, data);
            artifactMap.set(`${solPath}:${name}`, data);
        }
        return artifactMap;
    }

    /**
     * Load a contract from the artifacts root path. Can search by contract name or full path.
     * @param name either "ContractName" or "full/path/contract.sol:ContractName"
     * @returns a Truffle.Contract instance
     */
    require(name: string): Truffle.Contract<any> {
        if (this.artifactMap == null) {
            this.artifactMap = this.loadArtifactMap();
        }
        const artifactData = this.artifactMap.get(name);
        if (artifactData == null) {
            throw new Error(`Unknown artifact ${name}`);
        }
        if (artifactData.contractJson == null) {
            artifactData.contractJson = fs.readFileSync(artifactData.path).toString();
        }
        const json = JSON.parse(artifactData.contractJson) as ContractJson;
        return new MiniTruffleContract(this.settings, json.contractName, json.abi, json.bytecode, json);
    }
}
