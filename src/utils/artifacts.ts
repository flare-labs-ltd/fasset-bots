import { readFileSync } from "fs";
import { glob } from "glob";
import { basename, extname } from "path";
import { web3 } from "./helpers";

const createContract = require("@truffle/contract");

export function loadContract<T>(path: string): T {
    const abi = JSON.parse(readFileSync(path).toString());
    const contract = createContract(abi);
    contract.setProvider(web3.currentProvider);
    return contract;
}

interface ArtifactData {
    name: string;
    path: string;
    contract?: any;
}

class ArtifactsImpl {
    artifactMap?: Map<string, ArtifactData>;
    
    loadArtifactMap() {
        this.artifactMap = new Map();
        const paths = glob.sync("artifacts/**/*.json");
        for (const path of paths) {
            const name = basename(path, extname(path));
            const data: ArtifactData = { name: name, path: path };
            this.artifactMap.set(name, data);
            this.artifactMap.set(path, data);
        }
    }
    
    require(name: string) {
        if (this.artifactMap == null) {
            this.loadArtifactMap();
        }
        const artifactData = this.artifactMap!.get(name);
        if (artifactData == null) {
            throw new Error(`Unknown artifact ${name}`);
        }
        if (artifactData.contract == null) {
            artifactData.contract = loadContract(artifactData.path);
        }
        return artifactData.contract;
    }
}

export const artifacts: Truffle.Artifacts = new ArtifactsImpl();
