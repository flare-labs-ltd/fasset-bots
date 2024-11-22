export interface FspStatusResult {
    active: FspLatestRoundResult;
    latest_fdc: FspLatestRoundResult;
    latest_ftso: FspLatestRoundResult;
}

export interface FspLatestRoundResult {
    voting_round_id: number | string;
    start_timestamp: number | string;
}

export interface FtsoFeedResultWithProof {
    body: FtsoFeedResult;
    proof: string[];
}

export interface FtsoFeedResult {
    votingRoundId: number | string;
    id: string; // Needs to be 0x-prefixed for abi encoding
    value: number | string;
    turnoutBIPS: number | string;
    decimals: number | string;
}
