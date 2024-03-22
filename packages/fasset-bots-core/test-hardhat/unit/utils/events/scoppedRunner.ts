import { expect } from "chai";
import { ScopedRunner } from "../../../../src/utils/events/ScopedRunner";
import { EventScope } from "../../../../src/utils/events/ScopedEvents";

describe("Scoped runner unit tests",  () => {
    const errorMessage = "Not implemented.";

    async function notImplemented(scope: EventScope): Promise<void> {
        try {
            throw Error(errorMessage);
        } catch (e) {
            scope.exitOnExpectedError(e, [], "AGENT", "");
        }
    }

    it("Should caught uncaught error", async () => {
        const runner = new ScopedRunner();
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await runner.startThread((scope) => notImplemented(scope));
        expect(runner.uncaughtErrors.length).to.eq(1);
    });
});
