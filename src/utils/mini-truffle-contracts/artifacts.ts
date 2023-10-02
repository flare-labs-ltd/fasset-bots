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
        private settings: ContractSettings,
    ) {}

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
