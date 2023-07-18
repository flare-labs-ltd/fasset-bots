/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect } from "chai";
import { ZERO_ADDRESS, toBN, toHex } from "../../../src/utils/helpers";
import { MerkleTree, commitHash, verifyWithMerkleProof } from "../../../src/utils/MerkleTree";

describe("Merkle tree unit tests", async () => {
    const makeHashes = (i: number) => new Array(i).fill(0).map(() => toHex(Math.floor(Math.random() * 10000000000000), 32));

    it("Should create empty tree", async () => {
        const tree = new MerkleTree([], true);
        expect(tree.hashCount).to.eq(0);
        expect(tree.root).to.be.null;
        expect(tree.rootBN.eqn(0)).to.true;
        expect(tree.sortedHashes.length).to.eq(0);
        expect(tree.tree.length).to.eq(0);
        expect(tree.getHash(0)).to.be.null;
        expect(tree.getProof(0)).to.be.null;
        expect(tree.getProofForValue("")).to.be.null;
        expect(verifyWithMerkleProof("", [], tree.root!)).to.be.false;
    });

    it("Should create tree", async () => {
        let hashes: string[] = [];
        const n = 10;
        for (let i = 1; i < n; i++) {
            hashes = makeHashes(i);
            const tree = new MerkleTree(hashes);
            expect(tree.tree.length).to.eq(2 * i - 1);
            expect(tree.hashCount).to.eq(i);
        }
        const tree = new MerkleTree(hashes, true);
        expect(tree.hashCount).to.eq(n - 1);
        expect(tree.rootBN.toString()).to.eq(toBN(tree.root!).toString());
        expect(tree.sortedHashes.length).to.eq(tree.hashCount);
        expect(tree.tree.length).to.eq(2 * (n - 1) - 1);
    });

    it("Should create tree and match leaves to initial hashes", async () => {
        for (let i = 1; i < 10; i++) {
            const hashes = makeHashes(i);
            const tree = new MerkleTree(hashes);
            const sortedHashes = tree.sortedHashes;
            for (let j = 0; j < i; j++) {
                expect(sortedHashes.indexOf(hashes[j])).to.be.gte(0);
            }
        }
    });

    it("Should create merkle tree and verify it via proof", async () => {
        for (let i = 1; i < 100; i++) {
            const hashes = makeHashes(i);
            const tree = new MerkleTree(hashes);
            for (let j = 0; j < tree.hashCount; j++) {
                const leaf = tree.getHash(j);
                const proof = tree.getProof(j);
                const ver = verifyWithMerkleProof(leaf!, proof!, tree.root!);
                expect(ver).to.be.true;
            }
        }
    });

    it("Should create merkle tree and verify it via 'proof value'", async () => {
        for (let i = 1; i < 100; i++) {
            const hashes = makeHashes(i);
            const tree = new MerkleTree(hashes);
            for (let j = 0; j < tree.hashCount; j++) {
                const leaf = tree.getHash(j);
                const proof = tree.getProofForValue(leaf!);
                const ver = verifyWithMerkleProof(leaf!, proof!, tree.root!);
                expect(ver).to.be.true;
            }
        }
    });

    it("Should create commit hash to be used with StateConnector.sol contract", async () => {
        const hashes = makeHashes(10);
        const tree = new MerkleTree(hashes);
        const cHash = commitHash(tree.root!, hashes[0], ZERO_ADDRESS);
        expect(cHash).to.not.be.null;
    });

    it("Should build a tree from leave hashes", async () => {
        const hashes = makeHashes(10);
        const tree = new MerkleTree(hashes);
        const sortedHashes = tree.sortedHashes;
        const doubleLeaves = sortedHashes.concat(sortedHashes);
        tree.build(doubleLeaves);
        expect(tree.root).eq(new MerkleTree(hashes).root);
    });

});