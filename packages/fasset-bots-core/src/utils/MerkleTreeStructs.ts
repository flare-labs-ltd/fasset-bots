import { EncodingUtils } from "./EncodingUtils";
import { ethers } from "ethers";
const coder = ethers.AbiCoder.defaultAbiCoder();



export interface FeedResult {
    readonly votingRoundId: number;
    readonly id: string; // Needs to be 0x-prefixed for abi encoding
    readonly value: number;
    readonly turnoutBIPS: number;
    readonly decimals: number;
}

export interface RandomResult {
    readonly votingRoundId: number;
    readonly value: string; // 0x-prefixed bytes32 encoded uint256
    readonly isSecure: boolean;
}

export interface ClaimResult {
    readonly rewardEpochId: number;
    readonly beneficiary: string; // Needs to be 0x-prefixed for abi encoding
    readonly amount: bigint;
    readonly claimType: number;
}

export interface IPriceFeedData {
    status: string;
    protocolId: number;
    votingRoundId: number;
    merkleRoot: string;
    isSecureRandom: boolean;
    tree: (FeedResult | RandomResult)[];
 }

export type TreeResult = FeedResult | RandomResult;


export function hashPriceFeedResult(feedResult: FeedResult): string {
    const abiInput = EncodingUtils.instance.getFunctionInputAbiData(
        "FtsoMerkleStructs",
        "feedStruct",
        0
    );
    const abiEncoded = coder.encode([abiInput.abi as any], [feedResult]);
    return ethers.keccak256(abiEncoded);
}

export function hashRewardClaimResult(claimResult: ClaimResult): string {
    const abiInput = EncodingUtils.instance.getFunctionInputAbiData(
        "ProtocolMerkleStructs",
        "rewardClaimStruct",
        0
    );
    const abiEncoded = coder.encode([abiInput.abi as any], [claimResult]);
    return ethers.keccak256(abiEncoded);
}

export function hashRandomResult(randomResult: RandomResult): string {
    const abiInput = EncodingUtils.instance.getFunctionInputAbiData(
        "FtsoMerkleStructs",
        "randomStruct",
        0
    );
    const abiEncoded = coder.encode([abiInput.abi as any], [randomResult]);
    return ethers.keccak256(abiEncoded);
}
