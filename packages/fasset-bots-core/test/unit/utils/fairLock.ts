import { assert } from "chai";
import { sleep } from "../../../src/utils";
import { FairLock } from "../../../src/utils/FairLock";

describe("Fair lock tests", () => {
    it("should lock and release in proper order", async () => {
        const lock = new FairLock();
        const results: number[] = [];
        const expected: number[] = [];
        let running = 0;
        async function doWork(i: number) {
            await lock.lockAndRun(async () => {
                assert.equal(running, 0);
                ++running;
                await sleep(Math.ceil(Math.random() * 100));
                results.push(i);
                --running;
            });
        }
        // run
        const promises: Promise<void>[] = [];
        for (let i = 0; i < 20; i++) {
            expected.push(i);
            const promise = doWork(i);
            promises.push(promise);
            await sleep(1);
        }
        await Promise.all(promises);
        // check
        assert.deepEqual(results, expected);
    });
});
