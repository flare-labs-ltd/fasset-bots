import { readFileSync } from "fs";
import { glob } from "glob";
import { basename, extname } from "path";

const createContract = require("@truffle/contract");

interface ArtifactData {
    name: string;
    path: string;
    contract?: any;
}

class ArtifactsImpl {
    artifactMap?: Map<string, ArtifactData>;
    web3?: Web3;

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

    loadContract<T>(path: string): T {
        const abi = JSON.parse(readFileSync(path).toString());
        const contract = createContract(abi);
        this.updateContractWeb3(contract);
        return contract;
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
            artifactData.contract = this.loadContract(artifactData.path);
        }
        return artifactData.contract;
    }
    
    updateWeb3(web3: Web3) {
        this.web3 = web3;
        if (this.artifactMap) {
            for (const artifact of this.artifactMap.values()) {
                if (artifact.contract) {
                    this.updateContractWeb3(artifact.contract);
                }
            }
        }
    }
    
    private updateContractWeb3(contract: any) {
        if (this.web3?.currentProvider != null) {
            contract.setProvider(this.web3.currentProvider);
            contract.setWallet(this.web3.eth.accounts.wallet);
        }
        if (this.web3?.eth.defaultAccount != null) {
            contract.defaults({ from: this.web3.eth.defaultAccount });
        }
    }
}

interface ArtifactsWithUpdate extends Truffle.Artifacts {
    updateWeb3(web3: Web3): void;
}

export const artifacts: ArtifactsWithUpdate = new ArtifactsImpl();
