import { readFileSync } from "fs";
import { globSync } from "glob";
import { basename, dirname, extname, relative } from "path";
import { ContractFactory, ContractJson, ContractSettings } from "./mini-truffle";

interface ArtifactData {
    name: string;
    path: string;
    contract?: Truffle.Contract<any>;
}

export function createArtifacts(settings: ContractSettings) {
    return new ArtifactsImpl(settings);
}

class ArtifactsImpl implements Truffle.Artifacts {
    private artifactMap?: Map<string, ArtifactData>;

    constructor(private settings: ContractSettings) {}

    loadArtifactMap(): void {
        this.artifactMap = new Map();
        const paths = globSync("artifacts/**/*.json");
        for (const path of paths) {
            const name = basename(path, extname(path));
            const solPath = relative("artifacts/", dirname(path)).replace(/\\/g, "/");
            const data: ArtifactData = { name: name, path: path };
            this.artifactMap.set(name, data);
            this.artifactMap.set(`${solPath}:${name}`, data);
        }
    }

    loadContract(path: string): Truffle.Contract<any> {
        const contractJson = JSON.parse(readFileSync(path).toString()) as ContractJson;
        const contract = new ContractFactory(this.settings, contractJson.contractName, contractJson.abi, contractJson);
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
