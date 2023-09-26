import fs from "fs";
import { globSync } from "glob";
import path from "path";
import { ContractJson, ContractSettings, MiniTruffleContract } from "./contracts";

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

    require(name: string): Truffle.Contract<any> {
        if (this.artifactMap == null) {
            this.loadArtifactMap();
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const artifactData = this.artifactMap!.get(name);
        /* istanbul ignore if */
        if (artifactData == null) {
            throw new Error(`Unknown artifact ${name}`);
        }
        if (artifactData.contractJson == null) {
            artifactData.contractJson = fs.readFileSync(artifactData.path).toString();
        }
        const contractJson = JSON.parse(artifactData.contractJson) as ContractJson;
        return new MiniTruffleContract(this.settings, contractJson.contractName, contractJson.abi, contractJson);
    }
}
