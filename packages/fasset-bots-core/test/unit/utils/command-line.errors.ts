import { expect } from "chai";
import { CommandLineError, requireNotNullCmd } from "../../../src/utils";

describe("command-line-errors unit tests", () => {
    const plaintext = "this is plain text";
    const exitCode = 2;

    it("Wrap command-lin-error", async () => {
        expect(CommandLineError.wrap(plaintext)).to.eq(plaintext);
        expect(CommandLineError.wrap({message: plaintext}).message).to.eq(plaintext);
    });

    it("Replace command-lin-error", async () => {
        expect(CommandLineError.replace("this is error", plaintext).message).to.eq(plaintext);
        expect(CommandLineError.replace("this is error", plaintext, exitCode).exitCode).to.eq(exitCode);
    });

    it("'Nullable' error", async () => {
        const fn = () => {
            return requireNotNullCmd(null, plaintext);
        };
        expect(fn).to.throw(plaintext);
    });
});
