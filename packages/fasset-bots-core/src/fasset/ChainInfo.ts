import { ChainId } from "../underlying-chain/ChainId";

export interface ChainInfo {
    chainId: ChainId;   // combination of chain name and source id
    name: string;       // chain token name
    symbol: string;     // chain token symbol
    decimals: number;
    amgDecimals: number;
    requireEOAProof: boolean;
}
