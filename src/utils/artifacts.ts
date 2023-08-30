import { readFileSync } from "fs";
import { globSync } from "glob";
import { basename, extname } from "path";
import Web3 from "web3";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const createContract = require("@truffle/contract");

interface ArtifactData {
    name: string;
    path: string;
    contract?: any;
}

class ArtifactsImpl {
    artifactMap?: Map<string, ArtifactData>;
    web3?: Web3;

    loadArtifactMap(): void {
        this.artifactMap = new Map();
        const paths = globSync("artifacts/**/*.json");
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
        contract._originalJson = abi;
        this.updateContractWeb3(contract);
        return contract;
    }

    require(name: string): ArtifactData {
        if (this.artifactMap == null) {
            this.loadArtifactMap();
        }
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

    updateWeb3(web3: Web3): void {
        this.web3 = web3;
        /* istanbul ignore else */
        if (this.artifactMap) {
            for (const artifact of this.artifactMap.values()) {
                if (artifact.contract) {
                    this.updateContractWeb3(artifact.contract);
                }
            }
        }
    }

    private updateContractWeb3(contract: any): void {
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
    updateWeb3?(web3: Web3): void;
}

export const artifacts: ArtifactsWithUpdate = createArtifacts();

function createArtifacts(): ArtifactsWithUpdate {
    return (global as any).artifacts ?? new ArtifactsImpl();
}
