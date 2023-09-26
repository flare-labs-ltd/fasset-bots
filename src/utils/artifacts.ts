import fs from "fs";
import { globSync } from "glob";
import path from "path";
import { ContractJson, ContractSettings, MiniTruffleContract } from "./mini-truffle";

interface ArtifactData {
    name: string;
    path: string;
    contract?: Truffle.Contract<any>;
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

    loadArtifactMap(): void {
        this.artifactMap = new Map();
        const paths = globSync(path.join(this.rootPath, "**/*.json").replace(/\\/g, "/"));
        for (const fpath of paths) {
            const name = path.basename(fpath, path.extname(fpath));
            const solPath = path.relative(this.rootPath, path.dirname(fpath)).replace(/\\/g, "/");
            const data: ArtifactData = { name: name, path: fpath };
            this.artifactMap.set(name, data);
            this.artifactMap.set(`${solPath}:${name}`, data);
        }
    }

    loadContract(fpath: string): Truffle.Contract<any> {
        const contractJson = JSON.parse(fs.readFileSync(fpath).toString()) as ContractJson;
        const contract = new MiniTruffleContract(this.settings, contractJson.contractName, contractJson.abi, contractJson);
        return contract;
    }

    require(name: string): Truffle.Contract<any> {
        if (this.artifactMap == null) {
            this.loadArtifactMap();
        }
        /* istanbul ignore next */
        const artifactData = this.artifactMap?.get(name);
        /* istanbul ignore if */
        if (artifactData == null) {
            throw new Error(`Unknown artifact ${name}`);
        }
        if (artifactData.contract == null) {
            artifactData.contract = this.loadContract(artifactData.path);
        }
        return artifactData.contract;
    }
}
