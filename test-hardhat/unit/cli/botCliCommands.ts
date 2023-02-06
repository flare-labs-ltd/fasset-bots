import { ORM } from "../../../src/config/orm";
import { toStringExp } from "../../../src/utils/helpers";
import { web3 } from "../../../src/utils/web3";
import { createTestAssetContext, TestAssetBotContext } from "../../utils/test-asset-context";
import { testChainInfo } from "../../../test/utils/TestChainInfo";
import { overrideAndCreateOrm } from "../../../src/mikro-orm.config";
import { createTestOrmOptions } from "../../../test/utils/test-bot-config";
import { BotCliCommands } from "../../../src/cli/BotCliCommands";
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

describe("Bot cli commands unit tests", async () => {
    let accounts: string[];
    let context: TestAssetBotContext;
    let orm: ORM;
    let ownerAddress: string;
    let botCliCommands: BotCliCommands;

    before(async () => {
        accounts = await web3.eth.getAccounts();
        orm = await overrideAndCreateOrm(createTestOrmOptions({ schemaUpdate: 'recreate' }));
        orm.em.clear();
        context = await createTestAssetContext(accounts[0], testChainInfo.xrp);
        // accounts
        ownerAddress = accounts[3];
        // bot cli commands
        botCliCommands = new BotCliCommands();
        botCliCommands.orm = orm;
        botCliCommands.context = context;
        botCliCommands.ownerAddress = ownerAddress;
    });

    it("Should create agent vault, deposit, enter and exit available list", async () => {
        const depositAmount = toStringExp(100_000_000, 18);
        const vaultAddress = await botCliCommands.createAgentVault();
        expect(vaultAddress).to.not.be.null;
        await botCliCommands.depositToVault(depositAmount, vaultAddress);
        const collateral = await context.wnat.balanceOf(vaultAddress);
        expect(collateral.toString()).to.eq(depositAmount);
        const agenInfoBefore = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agenInfoBefore.publiclyAvailable).to.be.false;
        await botCliCommands.enterAvailableList(vaultAddress, "500", "30000");
        const agenInfoMiddle = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agenInfoMiddle.publiclyAvailable).to.be.true;
        await botCliCommands.exitAvailableList(vaultAddress);
        const agenInfoAfter = await context.assetManager.getAgentInfo(vaultAddress);
        expect(agenInfoAfter.publiclyAvailable).to.be.false;
    });

});