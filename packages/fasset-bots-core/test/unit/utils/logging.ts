import { logger } from "../../../src/utils";

describe("logging unit tests", async () => {
    it("logger should work", () => {
        logger.info("This is a log line");
        logger.warn("This is a warning line");
        const err = new Error("An error message");
        logger.error("This is an error", err);
    });
});
