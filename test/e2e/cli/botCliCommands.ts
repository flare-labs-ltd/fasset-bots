import { expect, spy, use } from "chai";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
import { initWeb3 } from "../../../src/utils/web3";
import spies from "chai-spies";
import { getNativeAccountsFromEnv } from "../../test-utils/test-helpers";
import { COSTON_RPC } from "../../test-utils/test-bot-config";
use(spies);

describe("Bot cli commands unit tests", async () => {
    let botCliCommands: BotCliCommands;
    let accounts: string[];
    let ownerAddress: string;

    before(async () => {
        accounts = await initWeb3(COSTON_RPC, getNativeAccountsFromEnv(), null);
        ownerAddress = accounts[0];
    });

    it("Should initialize bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
        expect(botCliCommands.botConfig).to.be.undefined;
        expect(botCliCommands.context).to.be.undefined;
        expect(botCliCommands.ownerAddress).to.be.undefined;
        await botCliCommands.initEnvironment();
        expect(botCliCommands.botConfig.orm).to.not.be.null;
        expect(botCliCommands.context).to.not.be.null;
        expect(botCliCommands.ownerAddress).to.not.be.null;
    });

    it("Should create agent bot via bot cli commands", async () => {
        botCliCommands = new BotCliCommands();
        await botCliCommands.initEnvironment();
        const agent = await botCliCommands.createAgentVault();
        expect(agent.underlyingAddress).is.not.null;
        expect(agent.ownerAddress).to.eq(ownerAddress);
        // sort of clean up
        await agent.announceDestroy();
    });

    it("Should run command 'create'", async () => {
        botCliCommands = new BotCliCommands();
        await botCliCommands.initEnvironment();
        const spyAgent = spy.on(botCliCommands, "createAgentVault");
        await botCliCommands.run(["", "", "create"]);
        expect(spyAgent).to.be.called.once;
    });

});
