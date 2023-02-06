import { expect } from "chai";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";

describe("Bot cli commands unit tests", async () => {
    let botCliCommands: BotCliCommands;

    it("Should initialize bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
        expect(botCliCommands.orm).to.be.undefined;
        expect(botCliCommands.context).to.be.undefined;
        expect(botCliCommands.ownerAddress).to.be.undefined;
        await botCliCommands.initEnvironment();
        expect(botCliCommands.orm).to.not.be.null;
        expect(botCliCommands.context).to.not.be.null;
        expect(botCliCommands.ownerAddress).to.not.be.null;
    });

});